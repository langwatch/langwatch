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
  abstract resolve(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<"opencode" | "pi">;
}

/** Preserves process observability without coupling domain code to app metrics. */
export abstract class LangyTurnMetricsPort {
  abstract count(input: {
    outcome: "accepted" | "busy" | "mismatch" | "rejected" | "replay" | "failed";
  }): void;
}

/** Renders the already-validated transport context into Langy's system prompt. */
export abstract class LangyTurnContextPort {
  abstract render(context: object): string | null;
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
