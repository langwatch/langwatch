/**
 * The vocabulary one local-control session is defined by: the credential behind a socket, the
 * session it resolves to, the outcomes of authenticating and registering, and the narrow
 * collaborator shapes the core is given rather than reaching for. Shape only.
 */
/**
 * What a shared folder MEANS to the platform, independent of the transport
 * (ADR-129). WebSocket and long-poll both call this for auth, presence,
 * subscription, turn start, and frame translation; transports own only clocks.
 */

import type {
  LangyLocalWorkspaceConnectedEventData,
  LangyLocalWorkspaceDisconnectedEventData,
  LangyCredentialSession,
  LangyMessagePart,
  LangyMessageRole,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { LangyTurnInProgressError } from "@langwatch/langy-contract";
import type { LangyTokenBufferPort } from "../ports/langy-token-buffer.port.ts";
import type { SessionStateStore, Unsubscribe } from "@langwatch/redis-client/session-state";
import {} from "./langy-local-session-text.rules.ts";
import { workspaceNudgeSchema } from "../rules/langy-local-call-record.rules.ts";
import { PRESENCE_HEARTBEAT_MS } from "@langwatch/langy-contract";
import { LangyWaitExpiredError } from "@langwatch/langy-contract";
import { workspaceChannel } from "./langy-local-control-keys.rules.ts";
import type {
  ConnectedWorkspace,
  LangyLocalPresencePort,
} from "../ports/langy-local-presence.port.ts";
import {
  type LocalControlRefusedCode,
  type PlatformFrame,
  type WorkspaceInfo,
} from "@langwatch/langy-contract";
/** The credential behind one socket, once it resolved to a conversation. */
export interface ControlCredential {
  apiKeyId: string;
  projectId: string;
  /** The project's own address segment, so the follow along link names it. */
  projectSlug: string;
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
  /** When this connection registered, so a heartbeat can write the record back. */
  connectedAt: number;
  /** The folder itself, for the same reason. */
  workspace: WorkspaceInfo;
}

export type AuthenticateOutcome =
  | { ok: true; credential: ControlCredential }
  | { ok: false; code: LocalControlRefusedCode; message: string };

export type RegisterOutcome =
  | {
      ok: true;
      session: ControlSession;
      reply: PlatformFrame;
      /** Calls the command line says it's still running — marked handed over so a reconnect's pending-calls scan doesn't start a second copy. */
      inFlightCallIds: string[];
    }
  | { ok: false; code: LocalControlRefusedCode; message: string };

/** The one conversation read the core makes. */
export interface ControlConversations {
  findByIdVisible(args: { id: string; projectId: string; userId: string }): Promise<{
    id: string;
    title: string | null;
    currentTurnId: string | null;
    lastModel: string | null;
  } | null>;
  /** Writes one line into the transcript without starting a turn. */
  recordUserMessage(args: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    role?: LangyMessageRole;
  }): Promise<{ messageId: string }>;
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
export type ControlBuffer = Pick<LangyTokenBufferPort, "appendLocalWorkspace">;

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

/**
 * How this process reads the worker's bearer credential off a frame's headers.
 * A port because credential precedence is the deployment's published contract,
 * and a second reading of it here is how the two would drift.
 */
export type ControlCredentialReader = (
  header: (name: string) => string | undefined,
) => Readonly<{ token: string; projectId: string | null }> | null;

/**
 * The folder as the durable event carries it. The command line's checklist is
 * best effort, so a field it could not read is left out rather than recorded
 * as empty, which would read as an answer.
 */
export function eventWorkspace(
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
    ...(workspace.gitDirty !== undefined ? { gitDirty: workspace.gitDirty } : {}),
    ...(workspace.nodeVersion ? { nodeVersion: workspace.nodeVersion } : {}),
    ...(workspace.pythonVersion ? { pythonVersion: workspace.pythonVersion } : {}),
    ...(workspace.ghAuthenticated !== undefined
      ? { ghAuthenticated: workspace.ghAuthenticated }
      : {}),
    ...(workspace.packageManager ? { packageManager: workspace.packageManager } : {}),
  };
}

/** The one turn method a folder-connected session starts work through. */
export type LangyLocalConversationTurns = Readonly<{
  startConversationTurn(input: {
    projectId: string;
    idempotencyKey: string;
    session: LangyCredentialSession;
    requestedConversationId: string;
    messages: readonly { role: "user" | "assistant" | "system"; parts: LangyMessagePart[] }[];
    isRetry: boolean;
    turnContext: Record<string, never>;
  }): Promise<{ conversationId: string; turnId: string }>;
}>;
