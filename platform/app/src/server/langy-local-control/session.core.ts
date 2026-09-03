/**
 * What a shared folder MEANS to the platform, independent of the transport
 * that carries it (ADR-129).
 *
 * The WebSocket gateway and the long-poll routes both call this: authenticate
 * the minted session key, register presence, subscribe to the conversation's
 * channel, record the connection, start the next turn, and translate the
 * command line's frames into calls, results and permission cards. Everything
 * that decides a policy lives here; the transports own only their own clocks.
 */

import type {
  LangyLocalWorkspaceConnectedEventData,
  LangyLocalWorkspaceDisconnectedEventData,
} from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { extractCredentials } from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import { LangyTurnInProgressError } from "~/server/app-layer/langy/errors";
import { resolveLangyActorSession } from "~/server/app-layer/langy/langyApiKeyActorSession";
import { canModelSkipPermissions } from "~/server/app-layer/langy/langySkipPermissions";
import {
  createLangyTokenBuffer,
  type LangyTokenBuffer,
} from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type {
  AgentStateStore,
  Unsubscribe,
} from "~/server/connected-agents/state-store";
import type { LocalCallDispatcher } from "./call.dispatcher";
import { workspaceNudgeSchema } from "./call.dispatcher";
import { PRESENCE_HEARTBEAT_MS } from "./constants";
import type { ControlRequestService } from "./control-request.service";
import { workspaceChannel } from "./keys";
import type { ConnectedWorkspace, LocalWorkspacePresence } from "./presence";
import {
  type CallEnvelope,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalControlRefusedCode,
  type PermissionRequiredFrame,
  type PlatformFrame,
  type RegisterFrame,
  type ResultFrame,
} from "./protocol";
import type { UserWaitService } from "./user-wait.service";

const logger = createLogger("langwatch:langy:local-control:session");

/** The credential behind one socket, once it resolved to a conversation. */
export interface ControlCredential {
  apiKeyId: string;
  projectId: string;
  userId: string;
  conversationId: string;
  requestId: string;
}

/** One registered folder, as both transports hold it. */
export interface ControlSession {
  instanceId: string;
  conversationId: string;
  projectId: string;
  userId: string;
  requestId: string;
  apiKeyId: string;
  workspaceName: string;
  hostname: string;
}

export type AuthenticateOutcome =
  | { ok: true; credential: ControlCredential }
  | { ok: false; code: LocalControlRefusedCode; message: string };

export type RegisterOutcome =
  | { ok: true; session: ControlSession; reply: PlatformFrame }
  | { ok: false; code: LocalControlRefusedCode; message: string };

/** The one conversation read the core makes. */
export interface ControlConversations {
  findByIdVisible(args: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{
    id: string;
    title: string | null;
    currentTurnId: string | null;
    lastModel: string | null;
  } | null>;
}

/** The two durable dispatches the core makes. */
export interface ControlEvents {
  connectLocalWorkspace(
    data: LangyLocalWorkspaceConnectedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
  disconnectLocalWorkspace(
    data: LangyLocalWorkspaceDisconnectedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/** The model gate behind the skip switch, injected so a test can set it. */
export type ControlSkipGate = (args: {
  projectId: string;
  model: string;
}) => Promise<{ allowed: boolean }>;

/** The live edge the core writes the folder's comings and goings to. */
export type ControlBuffer = Pick<LangyTokenBuffer, "appendLocalWorkspace">;

/** The one turn call the core makes, as a type, so a test needs no worker. */
export interface ControlTurnStarter {
  start(args: {
    projectId: string;
    conversationId: string;
    userId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<void>;
}

export interface LocalControlSessionCoreOptions {
  prisma: PrismaClient;
  store: AgentStateStore;
  presence: LocalWorkspacePresence;
  dispatcher: LocalCallDispatcher;
  waits: UserWaitService;
  requests: ControlRequestService;
  /** Injected so the auto turn can be observed without a worker. */
  turns?: ControlTurnStarter;
  conversations?: ControlConversations;
  events?: ControlEvents;
  buffer?: ControlBuffer;
  skipGate?: ControlSkipGate;
  tokenResolver?: TokenResolver;
  now?: () => number;
}

export class LocalControlSessionCore {
  private readonly prisma: PrismaClient;
  private readonly store: AgentStateStore;
  private readonly tokenResolver: TokenResolver;
  private readonly turns: ControlTurnStarter;
  private readonly skipGate: ControlSkipGate;
  private readonly conversations: () => ControlConversations;
  private readonly events: () => ControlEvents;
  private readonly buffer: () => ControlBuffer;
  readonly presence: LocalWorkspacePresence;
  readonly dispatcher: LocalCallDispatcher;
  readonly waits: UserWaitService;
  readonly requests: ControlRequestService;
  readonly now: () => number;

  constructor(options: LocalControlSessionCoreOptions) {
    this.prisma = options.prisma;
    this.store = options.store;
    this.presence = options.presence;
    this.dispatcher = options.dispatcher;
    this.waits = options.waits;
    this.requests = options.requests;
    this.now = options.now ?? (() => Date.now());
    this.tokenResolver =
      options.tokenResolver ?? TokenResolver.create(options.prisma);
    this.turns = options.turns ?? defaultTurnStarter(options.prisma);
    this.skipGate = options.skipGate ?? canModelSkipPermissions;
    // The App is composed after this process core is built, so every port it
    // reads off the App is read at call time rather than at construction.
    const injectedConversations = options.conversations;
    const injectedEvents = options.events;
    const injectedBuffer = options.buffer;
    this.conversations = injectedConversations
      ? () => injectedConversations
      : () => getApp().langy.conversations;
    this.events = injectedEvents
      ? () => injectedEvents
      : () => getApp().commands.langy;
    this.buffer = injectedBuffer
      ? () => injectedBuffer
      : () => createLangyTokenBuffer({ redis: getApp().redis });
  }

  /**
   * The bearer key, and nothing else.
   *
   * Three refusals, and each one names a different mistake: a key that does
   * not resolve, a key that resolves but is not a Langy session key, and a
   * session key that controls no conversation (it was never approved for one,
   * or the folder was disconnected from the panel and its binding revoked).
   */
  async authenticate({
    authorization,
    projectId,
  }: {
    authorization?: string;
    projectId?: string;
  }): Promise<AuthenticateOutcome> {
    const credentials = extractCredentials((name) =>
      name.toLowerCase() === "authorization"
        ? authorization
        : name.toLowerCase() === "x-project-id"
          ? projectId
          : undefined,
    );
    if (!credentials) {
      return {
        ok: false,
        code: "api_key_invalid",
        message: "Send the Langy session key as a bearer token.",
      };
    }
    const resolved = await this.tokenResolver.resolve({
      token: credentials.token,
      ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
    });
    if (resolved?.type !== "apiKey") {
      return {
        ok: false,
        code: "api_key_invalid",
        message: "That key is not valid for this project.",
      };
    }
    // A key with no person behind it, a project key for instance, is refused
    // as the wrong kind rather than as an invalid one: it is a real key, and
    // saying so is what points the developer at the command that mints the
    // right one.
    if (!resolved.isLangySessionKey || !resolved.userId) {
      return {
        ok: false,
        code: "key_type_not_allowed",
        message:
          "Only the key that approving a control request mints can share a folder. Run `langwatch langy --share-control` and approve the request.",
      };
    }
    const binding = await this.requests.readKeyBinding(resolved.apiKeyId);
    if (!binding || binding.projectId !== resolved.project.id) {
      return {
        ok: false,
        code: "conversation_mismatch",
        message:
          "That key does not control a conversation any more. Ask Langy for the code change again.",
      };
    }
    return {
      ok: true,
      credential: {
        apiKeyId: resolved.apiKeyId,
        projectId: binding.projectId,
        userId: binding.userId,
        conversationId: binding.conversationId,
        requestId: binding.requestId,
      },
    };
  }

  /** Records the folder and answers with what the command line needs to know. */
  async register({
    credential,
    frame,
  }: {
    credential: ControlCredential;
    frame: RegisterFrame;
  }): Promise<RegisterOutcome> {
    const conversation = await this.conversations().findByIdVisible({
      id: credential.conversationId,
      projectId: credential.projectId,
      userId: credential.userId,
    });
    if (!conversation) {
      return {
        ok: false,
        code: "conversation_mismatch",
        message: "That conversation is no longer available.",
      };
    }

    const instanceId = frame.instance.id || `lci_${nanoid(10)}`;
    const now = this.now();
    await this.presence.register({
      conversationId: credential.conversationId,
      projectId: credential.projectId,
      userId: credential.userId,
      requestId: credential.requestId,
      instanceId,
      hostname: frame.instance.hostname,
      connectedAt: now,
      lastSeenAt: now,
      workspace: frame.workspace,
    });

    const session: ControlSession = {
      instanceId,
      conversationId: credential.conversationId,
      projectId: credential.projectId,
      userId: credential.userId,
      requestId: credential.requestId,
      apiKeyId: credential.apiKeyId,
      workspaceName: frame.workspace.name,
      hostname: frame.instance.hostname,
    };

    // The skip choice is the developer's, and the model behind it is the
    // platform's half of the answer. A conversation that moved to a model the
    // provider does not allow reports the cards back on, so the command line
    // never runs a session on a permission it no longer has.
    const skipPermissions =
      (await this.presence.readPolicy(credential.conversationId)) &&
      (await this.maySkip(session));
    if (!skipPermissions) {
      await this.presence.writePolicy({
        conversationId: credential.conversationId,
        skipPermissions: false,
      });
    }

    return {
      ok: true,
      session,
      reply: {
        type: "registered",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        instanceId,
        heartbeatIntervalMs: PRESENCE_HEARTBEAT_MS,
        conversation: {
          id: conversation.id,
          title: conversation.title ?? "Langy",
          url: conversationUrl(conversation.id),
        },
        policy: { skipPermissions },
      },
    };
  }

  /** Every frame this pod should push to the folder's socket. */
  async subscribe(
    session: ControlSession,
    send: (frame: PlatformFrame) => void,
  ): Promise<Unsubscribe> {
    return this.store.subscribe(
      workspaceChannel(session.conversationId),
      (raw) => void this.onNudge(session, raw, send),
    );
  }

  /**
   * Records the connection and starts the turn that says so.
   *
   * A turn already in flight is not a failure: the developer connected while
   * Langy was working, and the running turn picks the folder up on its next
   * call. The event still lands, so the card reads connected either way.
   */
  async afterRegister(session: ControlSession): Promise<void> {
    const workspace = await this.presence.read(session.conversationId);
    if (!workspace) return;

    await this.events().connectLocalWorkspace({
      tenantId: session.projectId,
      occurredAt: this.now(),
      conversationId: session.conversationId,
      requestId: session.requestId,
      userId: session.userId,
      instanceId: session.instanceId,
      workspace: eventWorkspace(workspace),
    });

    try {
      await this.turns.start({
        projectId: session.projectId,
        conversationId: session.conversationId,
        userId: session.userId,
        text: connectMessage(workspace.workspace, session.hostname),
        idempotencyKey: `local-connect:${session.requestId}`,
      });
    } catch (error) {
      if (LangyTurnInProgressError.is(error)) {
        logger.info(
          { conversationId: session.conversationId },
          "folder connected while a turn was running, no second turn started",
        );
        return;
      }
      throw error;
    }
  }

  /** Keeps presence alive for one socket. */
  async heartbeat(session: ControlSession): Promise<void> {
    await this.presence.heartbeat({
      conversationId: session.conversationId,
      instanceId: session.instanceId,
    });
  }

  /** The command line started the call. */
  async ack(session: ControlSession, callId: string): Promise<void> {
    const call = await this.dispatcher.read(callId);
    if (call?.conversationId !== session.conversationId) return;
    await this.dispatcher.ack(callId);
  }

  /** The command line answered the call. */
  async result(session: ControlSession, frame: ResultFrame): Promise<void> {
    const call = await this.dispatcher.read(frame.callId);
    if (call?.conversationId !== session.conversationId) return;
    await this.dispatcher.result({ callId: frame.callId, frame });
  }

  /** The command line needs the developer's answer before it runs the call. */
  async permissionRequired(
    session: ControlSession,
    frame: PermissionRequiredFrame,
  ): Promise<void> {
    const call = await this.dispatcher.read(frame.callId);
    if (!call || call.conversationId !== session.conversationId) return;
    const wait = await this.waits.startPermission({
      projectId: call.projectId,
      conversationId: call.conversationId,
      turnId: call.turnId,
      ...(call.toolCallId ? { toolCallId: call.toolCallId } : {}),
      callId: call.callId,
      summary: frame.summary,
      pattern: frame.pattern,
      reason: frame.reason,
      // The command line always offers the switch; whether the card may show
      // it is the platform's answer, and it is the model that decides.
      skipOffered: frame.skipOffered && (await this.maySkip(session)),
      workspaceName: session.workspaceName,
      hostname: session.hostname,
    });
    await this.dispatcher.awaitPermission({
      callId: call.callId,
      waitId: wait.waitId,
    });
  }

  /**
   * Whether the conversation's model is allowed to skip the permission cards.
   *
   * A model that cannot resolve, or a conversation that has run no turn yet,
   * answers no: the switch is offered only when the platform can name the
   * model and its provider's list allows it.
   */
  private async maySkip(session: ControlSession): Promise<boolean> {
    const conversation = await this.conversations().findByIdVisible({
      id: session.conversationId,
      projectId: session.projectId,
      userId: session.userId,
    });
    const model = conversation?.lastModel;
    if (!model) return false;
    const decision = await this.skipGate({
      projectId: session.projectId,
      model,
    });
    return decision.allowed;
  }

  /** Calls written for this folder while its socket was away. */
  async pendingCalls(session: ControlSession): Promise<CallEnvelope[]> {
    return this.dispatcher.pendingEnvelopes(session.conversationId);
  }

  /**
   * The folder is gone. Clears presence, records it, and fails the calls it was
   * working on so the worker's poll answers at once instead of at the deadline.
   */
  async retire(
    session: ControlSession,
    reason: "cli_exit" | "panel" | "presence_lost",
  ): Promise<void> {
    const cleared = await this.presence.deregister({
      conversationId: session.conversationId,
      instanceId: session.instanceId,
    });
    // A socket replaced by a newer share clears nothing, and must not cancel
    // the calls the new folder is already running.
    if (!cleared) return;

    for (const call of await this.dispatcher.listPendingForConversation(
      session.conversationId,
    )) {
      await this.dispatcher.cancel({
        callId: call.callId,
        code: "cancelled",
        message:
          "The shared folder disconnected, so the command did not finish.",
      });
    }

    await this.events().disconnectLocalWorkspace({
      tenantId: session.projectId,
      occurredAt: this.now(),
      conversationId: session.conversationId,
      instanceId: session.instanceId,
      reason,
    });
    await this.requests.revokeKeyBinding(session.apiKeyId);
    await this.announceWorkspace(session, "disconnected");
  }

  /** Puts the folder's connect or disconnect on the live edge of a running turn. */
  async announceWorkspace(
    session: ControlSession,
    state: "connected" | "disconnected",
  ): Promise<void> {
    const conversation = await this.conversations().findByIdVisible({
      id: session.conversationId,
      projectId: session.projectId,
      userId: session.userId,
    });
    const turnId = conversation?.currentTurnId;
    if (!turnId) return;
    const workspace = await this.presence.read(session.conversationId);
    await this.buffer().appendLocalWorkspace({
      conversationId: session.conversationId,
      turnId,
      entry: {
        state,
        name: workspace?.workspace.name ?? session.workspaceName,
        root: workspace?.workspace.root ?? "",
        hostname: session.hostname,
        ...(workspace?.workspace.gitBranch
          ? { gitBranch: workspace.workspace.gitBranch }
          : {}),
      },
    });
  }

  private async onNudge(
    session: ControlSession,
    raw: string,
    send: (frame: PlatformFrame) => void,
  ): Promise<void> {
    const parsed = safeNudge(raw);
    if (!parsed) return;
    if ("call" in parsed) {
      const call = await this.dispatcher.read(parsed.call);
      if (!call || call.conversationId !== session.conversationId) return;
      send({
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: this.dispatcher.envelopeOf(call),
      });
      return;
    }
    if ("cancel" in parsed) {
      send({
        type: "cancel",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: parsed.cancel,
      });
      return;
    }
    if ("permission" in parsed) {
      send({
        type: "permission",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: parsed.permission.callId,
        decision: parsed.permission.decision,
      });
      return;
    }
    if ("policy" in parsed) {
      send({
        type: "policy",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        skipPermissions: parsed.policy.skipPermissions,
      });
      return;
    }
    send({
      type: "disconnect",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      reason: parsed.disconnect.reason,
    });
  }
}

/**
 * The folder as the durable event carries it. The command line's checklist is
 * best effort, so a field it could not read is left out rather than recorded
 * as empty, which would read as an answer.
 */
function eventWorkspace(
  connected: ConnectedWorkspace,
): LangyLocalWorkspaceConnectedEventData["workspace"] {
  const { workspace } = connected;
  return {
    root: workspace.root,
    name: workspace.name,
    hostname: connected.hostname,
    os: workspace.os,
    ...(workspace.gitBranch ? { gitBranch: workspace.gitBranch } : {}),
    ...(workspace.gitRemote ? { gitRemote: workspace.gitRemote } : {}),
    ...(workspace.gitDirty !== undefined
      ? { gitDirty: workspace.gitDirty }
      : {}),
    ...(workspace.nodeVersion ? { nodeVersion: workspace.nodeVersion } : {}),
    ...(workspace.pythonVersion
      ? { pythonVersion: workspace.pythonVersion }
      : {}),
    ...(workspace.ghAuthenticated !== undefined
      ? { ghAuthenticated: workspace.ghAuthenticated }
      : {}),
    ...(workspace.packageManager
      ? { packageManager: workspace.packageManager }
      : {}),
  };
}

/** The message the connected folder starts the next turn with. */
export function connectMessage(
  workspace: { root: string; gitBranch?: string },
  hostname: string,
): string {
  const branch = workspace.gitBranch ? `, branch ${workspace.gitBranch}` : "";
  return `Local folder connected: ${workspace.root} on ${hostname}${branch}`;
}

/**
 * Where the panel opens one conversation, as a link the terminal can open.
 *
 * `BASE_HOST` is the external-facing origin, the same one the emails and the
 * API's `platformUrl` build their links from. A relative path is correct in
 * the browser and useless in a terminal, so the absolute form is what this
 * returns. An origin that is empty or has no scheme cannot be trusted to
 * build a link, so the path travels on its own rather than as a guess.
 */
export function conversationUrl(
  conversationId: string,
  baseHost: string | undefined = env.BASE_HOST,
): string {
  const path = `/?langyConversation=${encodeURIComponent(conversationId)}`;
  const origin = (baseHost ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

/** Starts the turn through the app layer, as the acting user. */
function defaultTurnStarter(prisma: PrismaClient): ControlTurnStarter {
  return {
    async start({ projectId, conversationId, userId, text, idempotencyKey }) {
      const actor = await resolveLangyActorSession({
        prisma,
        userId,
        now: new Date(),
      });
      if (!actor.ok) {
        logger.warn(
          { conversationId, reason: actor.reason },
          "no acting user for the folder-connected turn",
        );
        return;
      }
      await getApp().langy.turns.startConversationTurn({
        projectId,
        idempotencyKey,
        session: actor.session,
        requestedConversationId: conversationId,
        messages: [{ role: "user", parts: [{ type: "text", text }] }],
        isRetry: false,
        turnContext: {},
      });
    },
  };
}

function safeNudge(raw: string) {
  try {
    const parsed = workspaceNudgeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
