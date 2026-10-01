/**
 * Vocabulary for one local-control session: credential, session, auth/register outcomes and
 * collaborator shapes, independent of transport (ADR-129). Transports own only clocks.
 */

import {
  type LangyLocalWorkspaceConnectedEventData,
  type LangyLocalWorkspaceDisconnectedEventData,
  type LangyCredentialSession,
  type LangyMessagePart,
  type LangyMessageRole,
  type LocalControlRefusedCode,
  type PlatformFrame,
  type WorkspaceInfo,
} from "@langwatch/langy-contract";

import type { ConnectedWorkspace } from "../repositories/langy-local-presence.repository.ts";
import type { LangyTokenBufferRepository } from "../repositories/langy-token-buffer.repository.ts";

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
      /** Calls the command line says are running—handed over so reconnect doesn't restart them. */
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
export type ControlBuffer = Pick<LangyTokenBufferRepository, "appendLocalWorkspace">;

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
    messages: { role: "user" | "assistant" | "system"; parts: LangyMessagePart[] }[];
    isRetry: boolean;
    turnContext: Record<string, never>;
  }): Promise<{ conversationId: string; turnId: string }>;
}>;
