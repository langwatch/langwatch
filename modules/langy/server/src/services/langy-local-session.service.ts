/**
 * What a shared folder MEANS to the platform, independent of the transport
 * (ADR-129). WebSocket and long-poll both call this for auth, presence,
 * subscription, turn start, and frame translation; transports own only clocks.
 */

import type {} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { LangyTurnInProgressError } from "@langwatch/langy-contract";
import {
  LangyActorSessionService,
  type LangyActorUserReader,
} from "./langy-actor-session.service.ts";
import type { LangyTokenBufferPort } from "../ports/langy-token-buffer.port.ts";
import type { SessionStateStore, Unsubscribe } from "@langwatch/redis-client/session-state";
import {
  connectMessage,
  conversationTitle,
  conversationUrl,
} from "../rules/langy-local-session-text.rules.ts";
import type { LocalCallDispatcherService } from "./langy-local-call-dispatcher.service.ts";
import { workspaceNudgeSchema } from "../rules/langy-local-call-record.rules.ts";
import { PRESENCE_HEARTBEAT_MS } from "@langwatch/langy-contract";
import type { ControlRequestService } from "./langy-local-control-request.service.ts";
import { LangyWaitExpiredError } from "@langwatch/langy-contract";
import { workspaceChannel } from "../rules/langy-local-control-keys.rules.ts";
import type {
  LangyLocalPresencePort,
  PresenceHeartbeat,
} from "../ports/langy-local-presence.port.ts";
import {
  type CallEnvelope,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type PermissionAnsweredFrame,
  type PermissionRequiredFrame,
  type PlatformFrame,
  type RegisterFrame,
  type ResultFrame,
} from "@langwatch/langy-contract";
import type { UserWaitService } from "./langy-local-user-wait.service.ts";
import { LocalControlFramesService } from "./langy-local-session-frames.service.ts";

import {
  type AuthenticateOutcome,
  type ControlBuffer,
  type ControlConversations,
  type ControlCredential,
  type ControlCredentialReader,
  type ControlEvents,
  type ControlSession,
  type ControlSkipGate,
  type ControlTurnStarter,
  type LangyLocalConversationTurns,
  type RegisterOutcome,
  eventWorkspace,
} from "../rules/langy-local-session-contract.rules.ts";
import { LocalControlLifecycleService } from "./langy-local-session-lifecycle.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:langy:local-control:session");

export interface LocalControlSessionCoreOptions {
  /** The directory the worker's session key is resolved through. */
  apiKeys: ApiKeyApi;
  /** Reads the credential off the connecting frame. */
  readCredential: ControlCredentialReader;
  /** The user directory the acting person is read from. */
  actors: LangyActorUserReader;
  /** This deployment's own origin, for the follow-along link. */
  baseHost: string | undefined;
  store: SessionStateStore;
  presence: LangyLocalPresencePort;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  requests: ControlRequestService;
  /** Injected so the auto turn can be observed without a worker. */
  turns: ControlTurnStarter;
  conversations: ControlConversations;
  events: ControlEvents;
  buffer: ControlBuffer;
  skipGate: ControlSkipGate;
  now?: () => number;
}

export class LocalControlSessionCoreService {
  private readonly apiKeys: ApiKeyApi;
  private readonly readCredential: ControlCredentialReader;
  private readonly baseHost: string | undefined;
  private readonly store: SessionStateStore;
  private readonly turns: ControlTurnStarter;
  private readonly skipGate: ControlSkipGate;
  private readonly conversations: () => ControlConversations;
  private readonly events: () => ControlEvents;
  private readonly buffer: () => ControlBuffer;
  readonly presence: LangyLocalPresencePort;
  readonly dispatcher: LocalCallDispatcherService;
  readonly waits: UserWaitService;
  readonly requests: ControlRequestService;
  readonly now: () => number;

  static create(options: LocalControlSessionCoreOptions): LocalControlSessionCoreService {
    return new LocalControlSessionCoreService(options);
  }

  /** Starts the turn as the acting user, through whatever runs Langy turns here. */
  static turnStarter(options: {
    actors: LangyActorUserReader;
    turns: LangyLocalConversationTurns;
  }): ControlTurnStarter {
    return {
      async start({ projectId, conversationId, userId, text, idempotencyKey }) {
        const actor = await LangyActorSessionService.create({
          users: options.actors,
        }).resolve({ userId });

        if (!actor.ok) {
          logger.warn(
            { conversationId, reason: actor.reason },
            "no acting user for the folder-connected turn",
          );

          return;
        }

        await options.turns.startConversationTurn({
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

  private constructor(options: LocalControlSessionCoreOptions) {
    this.apiKeys = options.apiKeys;
    this.readCredential = options.readCredential;
    this.baseHost = options.baseHost;
    this.store = options.store;
    this.presence = options.presence;
    this.dispatcher = options.dispatcher;
    this.waits = options.waits;
    this.requests = options.requests;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.turns = options.turns;
    this.skipGate = options.skipGate;
    const conversations = options.conversations;
    const events = options.events;
    const buffer = options.buffer;
    this.conversations = () => conversations;
    this.events = () => events;
    this.buffer = () => buffer;
    this.lifecycle = LocalControlLifecycleService.create({
      buffer: this.buffer,
      conversations: this.conversations,
      events: this.events,
      dispatcher: this.dispatcher,
      presence: this.presence,
      requests: this.requests,
      now: this.now,
      isCurrentConnection: (session) => this.isCurrentConnection(session),
    });
    this.frames = LocalControlFramesService.create({
      conversations: this.conversations,
      dispatcher: this.dispatcher,
      waits: this.waits,
      skipGate: this.skipGate,
      isCurrentConnection: (session) => this.isCurrentConnection(session),
    });
  }

  private readonly frames: LocalControlFramesService;

  private readonly lifecycle: LocalControlLifecycleService;

  /**
   * The bearer key, and nothing else. Three distinct refusals: unresolvable
   * key, not a Langy session key, or a session key bound to no conversation.
   */
  async authenticate({
    authorization,
    projectId,
  }: {
    authorization?: string;
    projectId?: string;
  }): Promise<AuthenticateOutcome> {
    const credentials = this.readCredential((name) =>
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

    const resolved = await this.apiKeys.findResolvedToken({
      token: credentials.token,
      projectId: credentials.projectId,
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

    const binding = await this.requests.tryReadKeyBinding(resolved.apiKeyId);
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
        projectSlug: resolved.project.slug,
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
      connectedAt: now,
      workspace: frame.workspace,
    };

    // The skip choice is the developer's, and the model behind it is the
    // platform's half of the answer. A conversation that moved to a model the
    // provider does not allow reports the cards back on, so the command line
    // never runs a session on a permission it no longer has.
    const skipPermissions =
      (await this.presence.readPolicy(credential.conversationId)) &&
      (await this.frames.maySkip(session));
    if (!skipPermissions) {
      await this.presence.writePolicy({
        conversationId: credential.conversationId,
        skipPermissions: false,
      });
    }

    return {
      ok: true,
      session,
      inFlightCallIds: [...new Set(frame.instance.inFlightCallIds)],
      reply: {
        type: "registered",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        instanceId,
        heartbeatIntervalMs: PRESENCE_HEARTBEAT_MS,
        conversation: {
          id: conversation.id,
          title: conversationTitle(conversation.title),
          url: conversationUrl(conversation.id, this.baseHost, credential.projectSlug),
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
      (raw) => void this.lifecycle.onNudge(session, raw, send),
    );
  }

  /**
   * Records the connection and starts the turn that says so. A turn already
   * in flight is not a failure — it picks the folder up on its next call.
   */
  async afterRegister(session: ControlSession): Promise<void> {
    const workspace = await this.presence.read(session.conversationId);
    if (!workspace) {
      return;
    }

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
        text: connectMessage(),
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

  /**
   * Keeps presence alive for one connection, and writes the record back when
   * it lapsed while the connection was open (`PresenceHeartbeat`).
   */
  async heartbeat(session: ControlSession): Promise<PresenceHeartbeat> {
    return await this.presence.heartbeat({
      conversationId: session.conversationId,
      projectId: session.projectId,
      userId: session.userId,
      requestId: session.requestId,
      instanceId: session.instanceId,
      hostname: session.hostname,
      connectedAt: session.connectedAt,
      lastSeenAt: this.now(),
      workspace: session.workspace,
    });
  }

  /**
   * Is this connection still the folder of its conversation? Only a presence
   * record naming a DIFFERENT instance retires it — a lapsed-then-restored
   * record does not.
   */
  private async isCurrentConnection(session: ControlSession): Promise<boolean> {
    const workspace = await this.presence.read(session.conversationId);

    return !workspace || workspace.instanceId === session.instanceId;
  }
  /** The command line started the call. */
  ack(session: ControlSession, callId: string): Promise<void> {
    return this.frames.ack(session, callId);
  }

  /** The command line finished the call. */
  result(session: ControlSession, frame: ResultFrame): Promise<void> {
    return this.frames.result(session, frame);
  }

  /** The command line is asking the person for permission. */
  permissionRequired(session: ControlSession, frame: PermissionRequiredFrame): Promise<void> {
    return this.frames.permissionRequired(session, frame);
  }

  /** The person answered in the terminal rather than in the panel. */
  permissionAnswered(session: ControlSession, frame: PermissionAnsweredFrame): Promise<void> {
    return this.frames.permissionAnswered(session, frame);
  }

  async pendingCalls(session: ControlSession): Promise<CallEnvelope[]> {
    return this.dispatcher.pendingEnvelopes(session.conversationId);
  }
  /**
   * The folder is gone. Clears presence, records it, and fails the calls it was
   * working on so the worker's poll answers at once instead of at the deadline.
   */
  retire(
    ...args: Parameters<LocalControlLifecycleService["retire"]>
  ): ReturnType<LocalControlLifecycleService["retire"]> {
    return this.lifecycle.retire(...args);
  }

  /** Announces the folder on the live edge and in the durable log. */
  announceWorkspace(
    ...args: Parameters<LocalControlLifecycleService["announceWorkspace"]>
  ): ReturnType<LocalControlLifecycleService["announceWorkspace"]> {
    return this.lifecycle.announceWorkspace(...args);
  }
}
