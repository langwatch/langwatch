import type { AuthzPermission } from "@langwatch/authz-contract";
import type { CommandEnvelope } from "@langwatch/eventing";
import {
  type LangyAgentRespondedEventData,
  type LangyAgentResponseFailedEventData,
  type LangyAgentTurnAcceptedEventData,
  type LangyConversationArchivedEventData,
  type LangyConversationForkedEventData,
  type LangyConversationHandoffConsumedEventData,
  type LangyConversationHandoffPendingEventData,
  type LangyConversationMetadataUpdatedEventData,
  type LangyConversationStartedEventData,
  type LangyConversationTitleGeneratedEventData,
  type LangyCredentialSession,
  type LangyLocalControlRequestedEventData,
  type LangyLocalPolicyChangedEventData,
  type LangyLocalWorkspaceConnectedEventData,
  type LangyLocalWorkspaceDisconnectedEventData,
  type LangyMessageImportedEventData,
  type LangyMessageRecordedEventData,
  type LangyPlanUpdatedEventData,
  type LangyToolCallFailedEventData,
  type LangyToolCallInitiatedEventData,
  type LangyToolCallSucceededEventData,
  type LangyUserWaitEndedEventData,
  type LangyUserWaitStartedEventData,
  LANGY_TITLE_SOURCE,
} from "@langwatch/langy-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { z } from "zod";

import type {
  LANGY_ID_RESOURCES,
  LANGY_PROCESS_INTENT_TYPES,
  langyGenerateTitleIntentSchema,
  langyProcessEventViewSchema,
  langyWorkerDispatchIntentSchema,
} from "../eventing/langy-conversation-process.schemas.ts";
import type { LangyLocalPresenceRepository } from "../repositories/langy-local-presence.repository.ts";
import type { LocalCallDispatcherService } from "../services/langy-local-call-dispatcher.service.ts";
import type { ControlRequestService } from "../services/langy-local-control-request.service.ts";
import type { UserWaitService } from "../services/langy-local-user-wait.service.ts";

export type LangyProcessIntentType =
  (typeof LANGY_PROCESS_INTENT_TYPES)[keyof typeof LANGY_PROCESS_INTENT_TYPES];

export const langyConversationProcessStateSchema = z.object({
  currentTurnId: z.string().nullable(),
  turnStatus: z.enum(["idle", "running", "completed", "failed"]),
  titleSource: z.enum(LANGY_TITLE_SOURCE),
  /**
   * One-shot latch: automatic title intent already recorded. Only generated
   * at the first successful agent_responded boundary while the title is
   * still derived, never again once set or titleSource leaves "derived".
   */
  autoTitleRequested: z.boolean(),
  archived: z.boolean(),
  /** ADR-048: id of the turn whose resume handoff is pending — identity only. */
  pendingHandoffTurnId: z.string().nullable(),
});
export type LangyConversationProcessState = z.infer<typeof langyConversationProcessStateSchema>;

export type LangyWorkerDispatchIntent = z.infer<typeof langyWorkerDispatchIntentSchema>;

export type LangyGenerateTitleIntent = z.infer<typeof langyGenerateTitleIntentSchema>;

export type LangyProcessEventView = z.infer<typeof langyProcessEventViewSchema>;

/**
 * The content boundary every pipeline event crosses before the process
 * manager sees it: identities and flags only, never parts/tokens/titles.
 */
export interface LangyProcessEventViewer {
  toView(event: unknown): LangyProcessEventView;
}

export interface LangyWorkerDispatcher {
  dispatchTurn(params: LangyWorkerDispatchIntent & { projectId: string }): Promise<void>;
}

export interface LangyTitleGeneration {
  generateTitle(params: LangyGenerateTitleIntent & { projectId: string }): Promise<void>;
}

export interface LangyEffectMembers {
  workerDispatch: LangyWorkerDispatcher;
  titleGeneration: LangyTitleGeneration;
}

/**
 * Generates a conversation title from the transcript so far, or null when
 * the transcript is empty or the model call failed. Declared here since
 * the effect ports are its only consumer.
 */
export type LangyTitleGenerator = (input: {
  projectId: string;
  conversationId: string;
}) => Promise<LangyGeneratedTitle>;

/** A title and the model that wrote it, or `unchanged` when the conversation keeps its title. */
export type LangyGeneratedTitle =
  | { outcome: "generated"; title: string; model: string }
  | { outcome: "unchanged" };

/** The stable identity every frame is bound to. */
export interface LangyFrameIdentity {
  projectId: string;
  userId: string;
  conversationId: string;
  turnId: string;
}

/** The signed-over material: identity + this frame's nonce + its exact payload bytes. */
export interface LangyFrameSigned extends LangyFrameIdentity {
  /** 16 random bytes, hex — unique per frame; the relay dedups on it. */
  frameNonce: string;
  /**
   * The exact payload string the worker serialised and signed. Verification
   * re-signs THESE bytes verbatim — the relay must not re-serialise before
   * checking, or a lossless round-trip difference would break the MAC.
   */
  payload: string;
}

/** A frame on the wire: the signed material plus its MAC. */
export interface LangyFrameEnvelope extends LangyFrameSigned {
  /** hex HMAC-SHA256 over the length-prefixed signing input. */
  mac: string;
}

/** The frame-authentication boundary: sign, verify, mint, and generate a nonce. */
export interface LangyFrameAuth {
  computeFrameMac(runToken: string, frame: LangyFrameSigned): string;
  signFrame(runToken: string, identity: LangyFrameIdentity, payload: string): LangyFrameEnvelope;
  verifyFrame(runToken: string, frame: LangyFrameEnvelope): boolean;
  mintRunToken(): string;
  newFrameNonce(): string;
}

/** Mints a KSUID for one of Langy's named id resources. */
export interface LangyIds {
  generateId(resource: keyof typeof LANGY_ID_RESOURCES): string;
}

/** Counts minted/revoked/reaped as one series with operation labels so dashboards read
 * minted-minus-revoked without joining (a port because App and worker export differently). */
export interface LangySessionKeyMetrics {
  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void;
}

/** Who a backend edit is recorded as. */
export type LangyBackendActor = Readonly<{ userId: string; label: string }>;

/** The document a transform rewrites, at the version it was read at. */
export type LangyBackendStateRead = Readonly<{
  /** The row a save is addressed to, which a slug alone does not name. */
  documentId: string;
  version: number;
  /** `null` when the target exists but holds no state yet. */
  state: unknown;
}>;

/**
 * A save either lands, or a concurrent writer moved the document on. The stale
 * branch is a value rather than a thrown error so this package classifies none
 * of another feature's failures.
 */
export type LangyBackendSaveResult =
  | Readonly<{ saved: true; version: number }>
  | Readonly<{ saved: false; reason: "stale" }>;

/** A run either starts, or the saved document refuses it by name. */
export type LangyBackendRunResult =
  | Readonly<{ started: true; runId: string; total: number }>
  | Readonly<{ started: false; refusal: string }>;

export interface LangyUiActionBackend {
  /**
   * The board as an agent reads it, from the saved document, with the version
   * that projection was taken at.
   */
  project(args: {
    projectId: string;
    target: string;
    payload: unknown;
  }): Promise<{ version: number; projection: Record<string, unknown> }>;

  readState(args: { projectId: string; target: string }): Promise<LangyBackendStateRead>;

  saveState(args: {
    projectId: string;
    documentId: string;
    state: unknown;
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult>;

  /** Starts the run the open page would have started, over the saved document. */
  startRun(args: {
    projectId: string;
    target: string;
    payload: unknown;
    actor: LangyBackendActor;
  }): Promise<LangyBackendRunResult>;
}

/**
 * How an away page is stood in for: the saved document is read, rewritten by
 * the action's own transform, or run.
 */
export type LangyUiActionBackendMode = "read" | "transform" | "run";

/**
 * One dispatchable action, as the channel needs it. Structural rather than
 * imported from the declaring workbench, to avoid the cross-feature reach
 * this port exists to prevent.
 */
export type LangyUiActionDefinition = Readonly<{
  /**
   * Parses the dispatched payload; a failure is refused, never forwarded.
   * Discriminated result rather than a Zod type, to keep the schema library
   * the catalogue's own business.
   */
  payloadSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: unknown } | { success: false; error: { issues: readonly unknown[] } };
  };
  /** What the page is expected to answer with. Declared, not enforced here. */
  resultSchema?: unknown;
  /** How long the page has to finish, before the channel's own ceiling. */
  executeBudgetMs?: number;
  /** Whether an away page can be stood in for by a backend run, and how. */
  backend?: LangyUiActionBackendMode;
  /**
   * The saved-state rewrite a backend run applies, where one exists. Declared
   * as a method so a page family's own transform, which reads a state type
   * this package never names, satisfies it.
   */
  transform?(args: { state: unknown; payload: unknown }): {
    state: unknown;
    result?: unknown;
  };
  /** The permission the DOOR enforces before a dispatch reaches this service. */
  requiredPermission: AuthzPermission;
}>;

/** Looks one action kind up across every page family this process serves.
 * Rejects an unknown kind with `LangyUiActionUnknownError` rather than
 * answering null: a dispatch naming a kind this process does not serve is a
 * client mistake, not a normal absence. */
export interface LangyUiActionCatalog {
  getByKind(kind: string): LangyUiActionDefinition;
}

/**
 * Preserves the block-salvage series `LangyFinalPartsService.build` counts, without coupling the
 * feature to app metrics. `blockCounter()` returns the per-reason counter callback.
 */
export abstract class LangyBlockMetrics {
  abstract blockCounter(): (reason: string) => void;
}

/** Supplies feature-flag-derived worker-harness selection. */
export abstract class LangyHarness {
  /**
   * Property rather than a method on purpose: methods are bivariant in
   * their parameters, so a resolver requiring an extra dependency could
   * still be wired here and compile. A property is contravariant, so it cannot.
   */
  abstract resolve: (input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<"opencode" | "pi">;
}

/** Preserves process observability without coupling domain code to app metrics. */
export abstract class LangyTurnMetrics {
  abstract count(input: {
    outcome: "accepted" | "busy" | "mismatch" | "rejected" | "replay" | "failed";
  }): void;
}

/** Renders the already-validated transport context into Langy's system prompt. */
export abstract class LangyTurnContextRenderer {
  abstract render(input: { context: object; isUiActionSurfaceOpen: boolean }): string | null;
}

/** The rollout flag `LangyUiActionSurface.resolve` evaluates. */
export const LANGY_UI_ACTIONS_FLAG = "release_langy_ui_actions" as const;

/** Answers whether the live UI-action channel is open; fails closed to never stop turns.
 * The turn block advertises the channel only while dispatch would answer it. */
export abstract class LangyUiActionSurface {
  abstract resolve(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean>;
}

/** Mints and revokes the restricted worker session credential. */
export abstract class LangySessionKey {
  abstract mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }>;
  abstract revoke(input: { apiKeyId: string; projectId: string }): Promise<void>;
}

/** Checks and reserves GitHub pull-request capacity for Langy turns. */
export abstract class LangyGithubPermit {
  abstract reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }>;
  abstract release(input: { userId: string }): Promise<void>;
  abstract check(input: { userId: string }): Promise<{ allowed: boolean }>;
}

/** Resolves the project-configured model for a Langy turn. */
export abstract class LangyModel {
  abstract resolve(input: { projectId: string }): Promise<{ modelId: string }>;
}

/** Command dispatchers injected from the event-sourcing pipeline registry. */
type Dispatch<T> = (data: T & CommandEnvelope) => Promise<void>;

/** All sixteen conversation writes from the agent-pipeline dispatcher. A dependency token
 * (shared with scenario feature). Declared as abstract PROPERTIES not methods (like LangyHarness)
 * to make contravariance catch shape mismatches at compile time. */
export abstract class LangyConversationCommands {
  abstract createConversation: Dispatch<LangyConversationStartedEventData>;
  abstract forkConversation: Dispatch<LangyConversationForkedEventData>;
  abstract recordMessage: Dispatch<LangyMessageRecordedEventData>;
  abstract importMessage: Dispatch<LangyMessageImportedEventData>;
  abstract acceptAgentTurn: Dispatch<
    LangyAgentTurnAcceptedEventData & {
      conversationStart?: Omit<LangyConversationStartedEventData, "conversationId">;
      userMessage?: Omit<LangyMessageRecordedEventData, "conversationId">;
      consumeHandoffTurnId?: string;
    }
  >;
  abstract initiateToolCall: Dispatch<LangyToolCallInitiatedEventData>;
  abstract succeedToolCall: Dispatch<LangyToolCallSucceededEventData>;
  abstract failToolCall: Dispatch<LangyToolCallFailedEventData>;
  abstract updatePlan: Dispatch<LangyPlanUpdatedEventData>;
  abstract failAgentResponse: Dispatch<LangyAgentResponseFailedEventData>;
  abstract recordAgentResponse: Dispatch<LangyAgentRespondedEventData>;
  abstract archiveConversation: Dispatch<LangyConversationArchivedEventData>;
  abstract updateConversationMetadata: Dispatch<LangyConversationMetadataUpdatedEventData>;
  abstract recordTurnHandoff: Dispatch<LangyConversationHandoffPendingEventData>;
  abstract consumeTurnHandoff: Dispatch<LangyConversationHandoffConsumedEventData>;
  abstract generateConversationTitle: Dispatch<LangyConversationTitleGeneratedEventData>;
  // ADR-129 local control: the shared folder and the cards that wait for the
  // developer. Written by the local control services, folded by the spine and
  // the turn document.
  abstract requestLocalControl: Dispatch<LangyLocalControlRequestedEventData>;
  abstract connectLocalWorkspace: Dispatch<LangyLocalWorkspaceConnectedEventData>;
  abstract disconnectLocalWorkspace: Dispatch<LangyLocalWorkspaceDisconnectedEventData>;
  abstract changeLocalPolicy: Dispatch<LangyLocalPolicyChangedEventData>;
  abstract startUserWait: Dispatch<LangyUserWaitStartedEventData>;
  abstract endUserWait: Dispatch<LangyUserWaitEndedEventData>;
}

/** One process's local-control composition around one session store (ADR-129). */
export interface LocalControlRuntime {
  store: SessionStateStore;
  presence: LangyLocalPresenceRepository;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  requests: ControlRequestService;
}
