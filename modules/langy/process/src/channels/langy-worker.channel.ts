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

/** The channel to the external Langy worker manager. */
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
