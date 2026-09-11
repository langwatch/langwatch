import type { AuthzPermission } from "@langwatch/authz-contract";
import type { LangyCredentialSession, LangyTitleSource } from "@langwatch/langy-contract";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import {
  LANGY_ID_RESOURCES,
  LANGY_PROCESS_INTENT_TYPES,
  langyGenerateTitleIntentSchema,
  langyProcessEventViewSchema,
  langyWorkerDispatchIntentSchema,
} from "../processes/langy-conversation-process.types.ts";

export interface LangyInfrastructure {
  langyFrameAuth: LangyFrameAuth;
  langyIds: LangyIds;
  langyNavigateProject: LangyNavigateProject;
  langyNavigateResource: LangyNavigateResourceLocator;
  langyProcessEventView: LangyProcessEventViewer;
  langySessionKeyMetrics: LangySessionKeyMetrics;
  langyTitleGeneration: LangyTitleGeneration;
  langyTitleModel: LangyTitleModelResolver;
  langyUiActionBackend: LangyUiActionBackend;
  langyUiActionCatalog: LangyUiActionCatalog;
  langyWorkerDispatch: LangyWorkerDispatcher;
  langyWorker: LangyWorker;
  langyWorkerMetrics: LangyWorkerMetrics;
  langyBlockMetrics: LangyBlockMetrics;
  langyHarness: LangyHarness;
  langyTurnMetrics: LangyTurnMetrics;
  langyTurnContext: LangyTurnContextRenderer;
  langyUiActionSurface: LangyUiActionSurface;
  langySessionKey: LangySessionKey;
  langyGithubPermit: LangyGithubPermit;
  langyModel: LangyModel;
}

export type LangyProcessIntentType =
  (typeof LANGY_PROCESS_INTENT_TYPES)[keyof typeof LANGY_PROCESS_INTENT_TYPES];

export interface LangyConversationProcessState {
  currentTurnId: string | null;
  turnStatus: "idle" | "running" | "completed" | "failed";
  titleSource: LangyTitleSource;
  /**
   * One-shot latch: the automatic title intent was already recorded. The
   * title may only be generated at the first successful agent_responded
   * boundary while the title is still the derived placeholder — never again
   * from a counter or timer once this is set or titleSource leaves
   * "derived".
   */
  autoTitleRequested: boolean;
  archived: boolean;
  /** ADR-048: id of the turn whose resume handoff is pending — identity only. */
  pendingHandoffTurnId: string | null;
}

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
 * Generates a conversation title from the transcript so far, or null when the
 * transcript is empty or the model call failed. Declared here because the
 * effect ports are its only consumer: the process asks for a title, and where
 * the model comes from is the composition root's business.
 */
export type LangyTitleGenerator = (input: {
  projectId: string;
  conversationId: string;
}) => Promise<{ title: string; model: string } | null>;

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
  signFrame(
    runToken: string,
    identity: LangyFrameIdentity,
    payload: string,
  ): LangyFrameEnvelope;
  verifyFrame(runToken: string, frame: LangyFrameEnvelope): boolean;
  mintRunToken(): string;
  newFrameNonce(): string;
}

/** Mints a KSUID for one of Langy's named id resources. */
export interface LangyIds {
  generateId(resource: keyof typeof LANGY_ID_RESOURCES): string;
}

/**
 * The project half of a navigate address: every fallback URL is built under the
 * asking project's own slug, so the slug is read once, from the project the
 * turn belongs to, and never from anything the agent wrote.
 */
export interface LangyNavigateProject {
  /** The project's slug, or null when it cannot be read. */
  trySlugOf(projectId: string): Promise<string | null>;
}


export interface LangyNavigateResourceLocator {
  /**
   * The project-relative path this resource is read at, or null when nothing in
   * this project answers to the id.
   */
  tryLocate(input: {
    projectId: string;
    kind: LangyNavigateResourceKind;
    resourceId: string;
  }): Promise<string | null>;
}

/**
 * The session-key lifecycle counter, as the feature reports into it.
 *
 * Minting, revoking and reaping are three moments in one credential's life and
 * they are counted as one series with an operation label, so a dashboard can
 * read minted-minus-revoked as the live population without joining two metrics.
 *
 * It is a port because the two processes that run these operations export
 * differently: the App writes into its own `prom-client` registry, and a worker
 * composed from packages pushes over OTLP. Both write the same series name.
 */
export interface LangySessionKeyMetrics {
  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void;
}

/**
 * The one question the title generator asks of the deployment's model gateway.
 *
 * A port rather than the gateway itself, because WHICH model a project's title
 * call runs on is the deployment's cascade — the project's execution providers,
 * the feature key's resolution, the alternate when the resolved provider is
 * disabled and the execution parameters the proxy is handed. Langy owns the
 * prompt and the shape of a title; it owns none of that.
 *
 * The two-step resolution is the ADAPTER's, not this package's. A process
 * resolves the feature key first, and falls back to the named model only when
 * the cascade says nothing is configured for that key — and "nothing is
 * configured" is a typed refusal from the model-provider contract, which a
 * feature package that never depends on it cannot distinguish from a real
 * failure. Handing the fallback down as an argument is what keeps the
 * distinction where the type lives.
 */
export interface LangyTitleModelResolver {
  /**
   * The handle a title call runs on.
   *
   * Rejects rather than answering `null`: the generator turns any failure into
   * "the conversation keeps the title it has", and a resolver that answered
   * `null` would make an unconfigured deployment and a broken one look the
   * same in the one log line that reports it.
   */
  resolveTitleModel(input: {
    projectId: string;
    /** The cascade key a project may have pointed somewhere specific. */
    featureKey: string;
    /** The model to use where the key resolves to nothing at any scope. */
    fallbackModel: string;
  }): Promise<LanguageModel>;
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

/** Looks one action kind up across every page family this process serves. */
export interface LangyUiActionCatalog {
  tryFind(kind: string): LangyUiActionDefinition | null;
}

export type LangyDispatchOutcome =
  | "accepted"
  | "busy"
  | "credentialsRequired"
  | "rejected"
  | "unavailable";

export type LangyWorkerProbeInput = {
  projectId: string;
  actorUserId: string;
  conversationId: string;
  model?: string;
  hasGithubAuth: boolean;
  githubRepoScopeKey?: string;
  egressAllowlist?: string[];
  mirrorTier?: string;
  harness?: string;
};

export type LangyWorkerWarmInput = {
  projectId: string;
  actorUserId: string;
  conversationId: string;
  credentials: unknown;
  modelOverride?: string;
};

export type LangyWorkerDispatchInput = {
  intent: "create" | "revive" | "continue";
  conversationId: string;
  turnId: string;
  projectId: string;
  userId: string;
  runToken: string;
  prompt: string;
  system: string;
  historySeed?: string;
  credentials: unknown;
  modelOverride?: string;
  resumeToken?: string;
};

export type LangyWorkerCancelInput = {
  conversationId: string;
  turnId: string;
  projectId: string;
};

/** Process-owned adapter for the external Langy worker manager. */
export abstract class LangyWorker {
  abstract probe(input: LangyWorkerProbeInput): Promise<boolean>;
  abstract warm(input: LangyWorkerWarmInput): Promise<void>;
  abstract dispatch(input: LangyWorkerDispatchInput): Promise<LangyDispatchOutcome>;
  abstract cancel(input: LangyWorkerCancelInput): Promise<void>;
}

/** Preserves worker dispatch metrics without coupling the feature to app metrics. */
export abstract class LangyWorkerMetrics {
  abstract recordDispatch(input: { outcome: LangyDispatchOutcome | "error" }): void;
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
   * A property signature rather than a method on purpose: method parameters
   * are bivariant, and that is exactly what let a resolver requiring an extra
   * dependency be wired here bare — it compiled, then threw on every call and
   * fell back to one harness for everyone. A property is contravariant, so
   * that wiring cannot compile again.
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
  abstract tryRender(input: { context: object; isUiActionSurfaceOpen: boolean }): string | null;
}

/** The rollout flag `LangyUiActionSurface.resolve` evaluates. */
export const LANGY_UI_ACTIONS_FLAG = "release_langy_ui_actions" as const;

/**
 * Answers whether the live UI-action channel is open for this turn.
 *
 * The turn block advertises `langwatch ui actions` only while the dispatch
 * route would answer it; with the flag off that route is a dark 404, and an
 * agent sent there spends the turn on a surface that behaves as if it were
 * never deployed. Never throws: a flag-store blip must not stop the turn, and
 * must fail toward the closed channel — see the adapter for that contract.
 */
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

/**
 * Private port for Langy's Redis-backed feedback cadence.
 *
 * The portable contract exposes the two operations on LangyApi; Redis and
 * the cadence record do not become part of the feature boundary.
 */
export abstract class LangyFeedbackPromptRedis {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}
