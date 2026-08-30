/**
 * The socket side of connected agents: `GET /api/agents/connect` upgrades,
 * authenticates, registers the process's agents and holds the socket for
 * every call the dispatcher writes for its instance (ADR-128, "Transport").
 *
 * The gateway reads envelopes off Redis, never off the nudge message, and
 * rescans the instance's pending set when it registers, so a call written
 * while the socket was reconnecting is still delivered. It publishes the
 * instance as gone when the socket closes, so the dispatcher fails that
 * instance's calls at once instead of at the deadline.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { WebSocket, WebSocketServer } from "ws";
import { agentPlatformUrl } from "~/app/api/agents/agent-platform-url";
import type { PrismaClient } from "~/generated/prisma/client";
import { AgentService } from "~/server/agents/agent.service";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { TokenResolver } from "~/server/api-key/token-resolver";
import type { UpgradeRouter } from "~/server/websockets/upgrade-router";
import {
  type InstanceGone,
  type InstanceNudge,
  instanceNudgeSchema,
  type ReplyNudge,
  resultCapViolation,
  type StoredCall,
  type StoredResult,
  storedCallSchema,
} from "./call-envelope";
import {
  CALL_KEY_SLACK_SECONDS,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONCURRENCY_DEVELOPMENT,
  DEFAULT_CONCURRENCY_SHARED,
  MAX_CALL_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_WAIT_MS,
  PRESENCE_REFRESH_MS,
  RESULT_TTL_SECONDS,
  relayPayloadCaps,
} from "./constants";
import { AgentPayloadTooLargeError, AgentRegisterRefusedError } from "./errors";
import {
  DEVELOPMENT_ENVIRONMENT,
  deriveScope,
  identityKeyOf,
  isValidEnvironment,
  sanitizeEnvironment,
  scopeColumns,
} from "./identity";
import type { InstanceMeta } from "./instance.registry";
import {
  callAckKey,
  callKey,
  INSTANCE_GONE_CHANNEL,
  instanceChannel,
  pendingKey,
  replyChannel,
  resultKey,
} from "./keys";
import { normalizeParameterSchema } from "./parameter-spec";
import { touchAgentLastSeen } from "./presence.projection";
import {
  type PlatformFrame,
  PROTOCOL_VERSION,
  type RefusedCode,
  type RegisterFrame,
  type ResultFrame,
  sdkFrameSchema,
} from "./protocol";
import type { ConnectedAgentRuntime } from "./runtime";
import type { Unsubscribe } from "./state-store";

const logger = createLogger("langwatch:connected-agents:gateway");

export const CONNECT_PATH = "/api/agents/connect";

/** Close code for a service restart: the SDK reconnects at once. */
const SERVICE_RESTART_CLOSE_CODE = 1012;

/** Close code for a refused connection: the SDK prints and backs off. */
const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface ConnectGatewayOptions {
  runtime: ConnectedAgentRuntime;
  prisma: PrismaClient;
  /** The app replicas of this deployment, for the no-Redis refusal. */
  replicaCount: number;
  /** Where the platform is reached, for the urls in `registered`. */
  now?: () => number;
  pingIntervalMs?: number;
  pongWaitMs?: number;
}

/** One connected process, after its register frame was accepted. */
interface Session {
  socket: WebSocket;
  instanceId: string;
  projectId: string;
  projectSlug: string;
  agentIds: Set<string>;
  unsubscribe: Unsubscribe | null;
  /** Calls the socket is working on; used to fail them on close. */
  activeCallIds: Set<string>;
  alive: boolean;
  refresh: NodeJS.Timeout | null;
  ping: NodeJS.Timeout | null;
}

export class ConnectGateway {
  private readonly wss: WebSocketServer;
  private readonly runtime: ConnectedAgentRuntime;
  private readonly prisma: PrismaClient;
  private readonly replicaCount: number;
  private readonly now: () => number;
  private readonly pingIntervalMs: number;
  private readonly pongWaitMs: number;
  private readonly sessions = new Set<Session>();

  constructor(options: ConnectGatewayOptions) {
    this.runtime = options.runtime;
    this.prisma = options.prisma;
    this.replicaCount = options.replicaCount;
    this.now = options.now ?? (() => Date.now());
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.pongWaitMs = options.pongWaitMs ?? PONG_WAIT_MS;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: relayPayloadCaps().frameBytes,
    });
  }

  /** Mounts the upgrade path on the shared router. */
  mount(router: UpgradeRouter): void {
    router.register(CONNECT_PATH, (request, socket, head) =>
      this.upgrade(request, socket, head),
    );
  }

  /** How many processes hold a socket on this pod. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  private upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.accept(ws, request);
    });
  }

  /**
   * Authenticates the upgrade, then waits for the register frame. Every
   * refusal is one `refused` frame followed by a close.
   */
  private async accept(ws: WebSocket, request: IncomingMessage): Promise<void> {
    // A deployment property, decided before any credential is read: with
    // several replicas and no Redis, a call on one pod could never reach a
    // socket on another.
    if (!this.runtime.store.shared && this.replicaCount > 1) {
      this.refuse(
        ws,
        new AgentRegisterRefusedError({
          reason: "replica_count_unsupported",
          message:
            "Connected agents need Redis on a deployment with more than one app replica.",
        }),
      );
      return;
    }

    // The SDK sends its register frame the moment the socket opens, which
    // is before the credential lookup below has answered. Frames are held
    // until then, so the first one is never lost to an unattached listener.
    const held: WebSocket.RawData[] = [];
    const hold = (raw: WebSocket.RawData) => {
      held.push(raw);
    };
    ws.on("message", hold);

    let resolved: ResolvedToken;
    try {
      resolved = await this.authenticate(request);
    } catch (error) {
      ws.off("message", hold);
      this.refuse(ws, error);
      return;
    }

    ws.off("message", hold);
    const first = held.shift();
    if (first !== undefined) {
      void this.register(ws, resolved, first);
      return;
    }
    ws.once("message", (raw: WebSocket.RawData) => {
      void this.register(ws, resolved, raw);
    });
  }

  /** The project credential behind the upgrade, or the refusal. */
  private async authenticate(request: IncomingMessage): Promise<ResolvedToken> {
    const header = request.headers.authorization ?? "";
    const token = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    const projectHeader = request.headers["x-project-id"];
    const projectId = Array.isArray(projectHeader)
      ? projectHeader[0]
      : projectHeader;
    if (!token) {
      throw new AgentRegisterRefusedError({
        reason: "api_key_invalid",
        message: "Send the API key as Authorization: Bearer <key>.",
      });
    }

    const resolver = TokenResolver.create(this.prisma);
    const resolved = await resolver.resolve({
      token,
      projectId: projectId ?? null,
    });
    if (!resolved) {
      throw await this.refusalForMiss({ resolver, token, projectId });
    }
    if (resolved.type === "apiKey") {
      if (resolved.ingestSourceType || resolved.isLangySessionKey) {
        throw new AgentRegisterRefusedError({
          reason: "key_type_not_allowed",
          message:
            "An ingestion key or a Langy session key cannot connect an agent. Use a personal or a project API key.",
        });
      }
    }
    try {
      await enforceApiKeyCeiling({ resolved, permission: "scenarios:manage" });
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      throw new AgentRegisterRefusedError({
        reason: "permission_denied",
        message:
          "The API key needs the scenarios:manage permission to connect an agent.",
      });
    }
    return resolved;
  }

  /**
   * A key that reaches several projects and named none is told which ones,
   * so the SDK can print them; everything else is an invalid key.
   */
  private async refusalForMiss({
    resolver,
    token,
    projectId,
  }: {
    resolver: TokenResolver;
    token: string;
    projectId: string | undefined;
  }): Promise<AgentRegisterRefusedError> {
    if (!projectId) {
      const org = await resolver.resolveOrgOnly({ token });
      if (org.ok) {
        const projects = await this.prisma.project.findMany({
          where: {
            team: { organizationId: org.resolved.organizationId },
            archivedAt: null,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 50,
        });
        return new AgentRegisterRefusedError({
          reason: "project_required",
          message:
            "This API key reaches several projects. Send the project id in the X-Project-Id header.",
          meta: { projects },
        });
      }
    }
    return new AgentRegisterRefusedError({
      reason: "api_key_invalid",
      message: "The API key is not valid for this project.",
    });
  }

  /** Handles the register frame: rows, presence, subscriptions, reply. */
  private async register(
    ws: WebSocket,
    resolved: ResolvedToken,
    raw: WebSocket.RawData,
  ): Promise<void> {
    const parsed = parseSdkFrame(raw);
    if (parsed?.type !== "register") {
      this.refuse(
        ws,
        new AgentRegisterRefusedError({
          reason: "protocol_invalid",
          message: `The first frame must be a register frame with protocol ${PROTOCOL_VERSION}.`,
        }),
      );
      return;
    }
    const frame = parsed;
    const projectId = resolved.project.id;
    const userId = resolved.type === "apiKey" ? resolved.userId : null;

    let agents: {
      id: string;
      name: string;
      environment: string;
      notes: string[];
    }[];
    try {
      agents = await this.registerAgents({ frame, projectId, userId });
    } catch (error) {
      this.refuse(ws, error);
      return;
    }

    const session: Session = {
      socket: ws,
      instanceId: frame.instance.id,
      projectId,
      projectSlug: resolved.project.slug,
      agentIds: new Set(agents.map((agent) => agent.id)),
      unsubscribe: null,
      activeCallIds: new Set(frame.instance.inFlightCallIds),
      alive: true,
      refresh: null,
      ping: null,
    };
    this.sessions.add(session);

    const meta: InstanceMeta = {
      instanceId: frame.instance.id,
      projectId,
      hostname: frame.instance.hostname,
      username: frame.instance.username,
      pid: frame.instance.pid,
      sdk: frame.sdk,
      label: frame.instance.label ?? null,
      podId: this.runtime.podId,
      connectedAt: this.now(),
      maxConcurrency:
        frame.instance.maxConcurrency ??
        (agents.every((agent) => agent.environment === DEVELOPMENT_ENVIRONMENT)
          ? DEFAULT_CONCURRENCY_DEVELOPMENT
          : DEFAULT_CONCURRENCY_SHARED),
    };
    await this.runtime.registry.register({
      meta,
      agentIds: [...session.agentIds],
      now: this.now(),
    });
    session.unsubscribe = await this.runtime.store.subscribe(
      instanceChannel(session.instanceId),
      (message) => void this.onInstanceNudge(session, message),
    );

    ws.on("message", (data) => void this.onFrame(session, data));
    ws.on("pong", () => {
      session.alive = true;
    });
    ws.on("close", () => void this.onClose(session));
    ws.on("error", (error) => {
      logger.warn({ error, instanceId: session.instanceId }, "socket error");
    });
    this.startClocks(session);

    this.send(ws, {
      type: "registered",
      protocol: PROTOCOL_VERSION,
      agents: agents.map((agent) => ({
        name: agent.name,
        environment: agent.environment,
        id: agent.id,
        url: agentPlatformUrl({
          projectSlug: session.projectSlug,
          agentId: agent.id,
          agentType: "connected",
        }),
        parameterNotes: agent.notes,
      })),
      heartbeatIntervalMs: this.pingIntervalMs,
      instanceId: session.instanceId,
    });
    logger.info(
      {
        projectId,
        instanceId: session.instanceId,
        agentIds: [...session.agentIds],
        hostname: frame.instance.hostname,
      },
      "connected agent instance registered",
    );

    // Calls written for this instance while it was away.
    await this.deliverPending(session);
  }

  /** Upserts every agent of the frame; refuses the frame on the first bad one. */
  private async registerAgents({
    frame,
    projectId,
    userId,
  }: {
    frame: RegisterFrame;
    projectId: string;
    userId: string | null;
  }): Promise<
    { id: string; name: string; environment: string; notes: string[] }[]
  > {
    const service = AgentService.create(this.prisma);
    const registered: {
      id: string;
      name: string;
      environment: string;
      notes: string[];
    }[] = [];
    for (const agent of frame.agents) {
      const environment = sanitizeEnvironment(agent.environment);
      if (!isValidEnvironment(environment)) {
        throw new AgentRegisterRefusedError({
          reason: "environment_invalid",
          message: `The environment "${agent.environment}" is not valid. Use letters, digits, dashes and underscores, up to 32 characters.`,
        });
      }
      let normalized: ReturnType<typeof normalizeParameterSchema>;
      try {
        normalized = normalizeParameterSchema(agent.parameters);
      } catch (error) {
        if (!HandledError.isHandled(error)) throw error;
        throw new AgentRegisterRefusedError({
          reason: "parameters_invalid",
          message: `${agent.name}: ${error.message}`,
          meta: { agentName: agent.name, ...error.meta },
        });
      }
      const scope = deriveScope({
        environment,
        userId,
        hostname: frame.instance.hostname,
      });
      const identityKey = identityKeyOf({
        name: agent.name,
        environment,
        scope,
      });
      const row = await service.registerConnected({
        id: `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`,
        projectId,
        name: agent.name,
        config: {
          description: agent.description,
          parameters: normalized.parameters,
          timeoutMs: Math.min(
            agent.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
            MAX_CALL_TIMEOUT_MS,
          ),
          concurrency: agent.concurrency,
          sticky: agent.sticky,
          sdk: frame.sdk,
        },
        identity: { environment, identityKey, ...scopeColumns(scope) },
      });
      registered.push({
        id: row.id,
        name: row.name,
        environment,
        notes: normalized.notes,
      });
    }
    return registered;
  }

  /** Sends every call still pending for this instance. */
  private async deliverPending(session: Session): Promise<void> {
    const callIds = await this.runtime.store.zrangebyscore(
      pendingKey(session.instanceId),
      this.now(),
    );
    for (const callId of callIds) {
      if (session.activeCallIds.has(callId)) continue;
      await this.deliverCall(session, callId);
    }
  }

  /** Reads one envelope and sends it, if it is for an agent of this socket. */
  private async deliverCall(session: Session, callId: string): Promise<void> {
    const raw = await this.runtime.store.get(callKey(callId));
    if (!raw) return;
    let stored: StoredCall;
    try {
      stored = storedCallSchema.parse(JSON.parse(raw));
    } catch {
      logger.warn({ callId }, "envelope could not be read, dropping the call");
      return;
    }
    if (
      stored.instanceId !== session.instanceId ||
      stored.projectId !== session.projectId ||
      !session.agentIds.has(stored.envelope.agentId)
    ) {
      // A socket only ever sees calls for the agents it registered itself.
      logger.warn(
        {
          callId,
          instanceId: session.instanceId,
          agentId: stored.envelope.agentId,
        },
        "call routed at an instance that did not register its agent, refusing it",
      );
      await this.writeResult({
        stored,
        result: { instanceId: session.instanceId, disconnected: true },
      });
      return;
    }
    session.activeCallIds.add(callId);
    this.send(session.socket, {
      type: "call",
      protocol: PROTOCOL_VERSION,
      ...stored.envelope,
    });
  }

  private async onInstanceNudge(session: Session, raw: string): Promise<void> {
    let nudge: InstanceNudge;
    try {
      nudge = instanceNudgeSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if ("call" in nudge) {
      await this.deliverCall(session, nudge.call);
      return;
    }
    session.activeCallIds.delete(nudge.cancel);
    this.send(session.socket, {
      type: "cancel",
      protocol: PROTOCOL_VERSION,
      callId: nudge.cancel,
    });
  }

  private async onFrame(
    session: Session,
    raw: WebSocket.RawData,
  ): Promise<void> {
    const frame = parseSdkFrame(raw);
    if (!frame) return;
    switch (frame.type) {
      case "ack": {
        const stored = await this.readStoredCall(frame.callId);
        if (!stored || stored.instanceId !== session.instanceId) return;
        await this.runtime.store.set(
          callAckKey(frame.callId),
          "1",
          ttlOf(stored, this.now()),
        );
        await this.nudgeReply(stored, { callId: frame.callId, kind: "ack" });
        return;
      }
      case "result":
        await this.onResult(session, frame);
        return;
      case "deregister":
        session.socket.close(1000, "deregister");
        return;
      case "register":
        // A second register on an open socket is ignored; the SDK reconnects
        // with a fresh socket to change what it serves.
        return;
    }
  }

  private async onResult(session: Session, frame: ResultFrame): Promise<void> {
    const stored = await this.readStoredCall(frame.callId);
    if (!stored || stored.instanceId !== session.instanceId) return;
    session.activeCallIds.delete(frame.callId);
    const violation = resultCapViolation({
      output: frame.output,
      session: frame.session,
      caps: relayPayloadCaps(),
    });
    const result: StoredResult = violation
      ? tooLarge(session, violation)
      : {
          instanceId: session.instanceId,
          output: frame.output,
          session: frame.session,
          error: frame.error,
        };
    await this.writeResult({ stored, result });
  }

  private async writeResult({
    stored,
    result,
  }: {
    stored: StoredCall;
    result: StoredResult;
  }): Promise<void> {
    await this.runtime.store.set(
      resultKey(stored.envelope.callId),
      JSON.stringify(result),
      RESULT_TTL_SECONDS,
    );
    await this.nudgeReply(stored, {
      callId: stored.envelope.callId,
      kind: "result",
    });
  }

  private async nudgeReply(
    stored: StoredCall,
    nudge: ReplyNudge,
  ): Promise<void> {
    await this.runtime.store.publish(
      replyChannel(stored.replyTo),
      JSON.stringify(nudge),
    );
  }

  private async readStoredCall(callId: string): Promise<StoredCall | null> {
    const raw = await this.runtime.store.get(callKey(callId));
    if (!raw) return null;
    try {
      return storedCallSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Presence refresh on the SDK's pongs, and the ping that asks for them. */
  private startClocks(session: Session): void {
    session.ping = setInterval(() => {
      if (!session.alive) {
        logger.warn(
          { instanceId: session.instanceId },
          "no pong inside the wait, closing the socket",
        );
        session.socket.terminate();
        return;
      }
      session.alive = false;
      session.socket.ping();
      setTimeout(() => {
        if (!session.alive && session.socket.readyState === WebSocket.OPEN) {
          session.socket.terminate();
        }
      }, this.pongWaitMs).unref();
    }, this.pingIntervalMs);
    session.ping.unref();

    session.refresh = setInterval(() => {
      if (!session.alive) return;
      void this.runtime.registry.refresh({
        projectId: session.projectId,
        instanceId: session.instanceId,
        agentIds: [...session.agentIds],
        now: this.now(),
      });
      for (const agentId of session.agentIds) {
        void touchAgentLastSeen({
          prisma: this.prisma,
          projectId: session.projectId,
          agentId,
          now: this.now(),
        });
      }
    }, PRESENCE_REFRESH_MS);
    session.refresh.unref();
  }

  /** The socket is gone: retire presence, fail its calls, tell every pod. */
  private async onClose(session: Session): Promise<void> {
    if (!this.sessions.has(session)) return;
    this.sessions.delete(session);
    if (session.ping) clearInterval(session.ping);
    if (session.refresh) clearInterval(session.refresh);
    await session.unsubscribe?.();
    await this.runtime.registry.deregister({
      projectId: session.projectId,
      instanceId: session.instanceId,
      agentIds: [...session.agentIds],
      now: this.now(),
    });
    for (const callId of session.activeCallIds) {
      const stored = await this.readStoredCall(callId);
      if (!stored) continue;
      await this.writeResult({
        stored,
        result: { instanceId: session.instanceId, disconnected: true },
      });
    }
    await this.runtime.store.publish(
      INSTANCE_GONE_CHANNEL,
      JSON.stringify({
        instanceId: session.instanceId,
        projectId: session.projectId,
      } satisfies InstanceGone),
    );
    logger.info(
      { projectId: session.projectId, instanceId: session.instanceId },
      "connected agent instance gone",
    );
  }

  private refuse(ws: WebSocket, error: unknown): void {
    const refused =
      error instanceof AgentRegisterRefusedError
        ? error
        : new AgentRegisterRefusedError({
            reason: "api_key_invalid",
            message: "The connection could not be authenticated.",
          });
    if (!(error instanceof AgentRegisterRefusedError)) {
      logger.error({ error }, "connect refused by an unexpected error");
    }
    const { reason, ...meta } = refused.meta as {
      reason: RefusedCode;
    } & Record<string, unknown>;
    this.send(ws, {
      type: "refused",
      protocol: PROTOCOL_VERSION,
      code: reason,
      message: refused.message,
      ...(Object.keys(meta).length > 0 && { meta }),
    });
    ws.close(POLICY_VIOLATION_CLOSE_CODE, reason);
  }

  private send(ws: WebSocket, frame: PlatformFrame): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  }

  /** Closes every socket with 1012 so the SDKs reconnect at once. */
  async close(): Promise<void> {
    for (const session of [...this.sessions]) {
      session.socket.close(SERVICE_RESTART_CLOSE_CODE, "service restart");
      await this.onClose(session);
    }
    // A socket that never registered, or whose peer is not reading, would
    // keep the server open past the shutdown budget.
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function parseSdkFrame(raw: WebSocket.RawData) {
  try {
    const parsed = sdkFrameSchema.safeParse(JSON.parse(rawToString(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

function ttlOf(stored: StoredCall, now: number): number {
  return Math.max(
    1,
    Math.ceil((stored.envelope.deadlineAt - now) / 1000) +
      CALL_KEY_SLACK_SECONDS,
  );
}

function tooLarge(
  session: Session,
  violation: {
    what: "result" | "session";
    sizeBytes: number;
    limitBytes: number;
  },
): StoredResult {
  const error = new AgentPayloadTooLargeError(violation);
  return {
    instanceId: session.instanceId,
    error: { code: error.code, message: error.message },
  };
}
