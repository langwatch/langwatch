import type { LangyCredentialSession } from "@langwatch/langy-contract";

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
export abstract class LangyWorkerPort {
  abstract probe(input: LangyWorkerProbeInput): Promise<boolean>;
  abstract warm(input: LangyWorkerWarmInput): Promise<void>;
  abstract dispatch(input: LangyWorkerDispatchInput): Promise<LangyDispatchOutcome>;
  abstract cancel(input: LangyWorkerCancelInput): Promise<void>;
}

/** Preserves worker dispatch metrics without coupling the feature to app metrics. */
export abstract class LangyWorkerMetricsPort {
  abstract recordDispatch(input: { outcome: LangyDispatchOutcome | "error" }): void;
}

/** Supplies feature-flag-derived worker-harness selection. */
export abstract class LangyHarnessPort {
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
export abstract class LangyTurnMetricsPort {
  abstract count(input: {
    outcome: "accepted" | "busy" | "mismatch" | "rejected" | "replay" | "failed";
  }): void;
}

/** Renders the already-validated transport context into Langy's system prompt. */
export abstract class LangyTurnContextPort {
  abstract render(input: { context: object; isUiActionSurfaceOpen: boolean }): string | null;
}

/** The rollout flag `LangyUiActionSurfacePort.resolve` evaluates. */
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
export abstract class LangyUiActionSurfacePort {
  abstract resolve(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean>;
}

/** Mints and revokes the restricted worker session credential. */
export abstract class LangySessionKeyPort {
  abstract mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }>;
  abstract revoke(input: { apiKeyId: string; projectId: string }): Promise<void>;
}

export class LangySessionKeyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangySessionKeyScopeError";
  }
}

/** Checks and reserves GitHub pull-request capacity for Langy turns. */
export abstract class LangyGithubPermitPort {
  abstract reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }>;
  abstract release(input: { userId: string }): Promise<void>;
  abstract check(input: { userId: string }): Promise<{ allowed: boolean }>;
}

/** Resolves the project-configured model for a Langy turn. */
export abstract class LangyModelPort {
  abstract resolve(input: { projectId: string }): Promise<{ modelId: string }>;
}
