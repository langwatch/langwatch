import type { LangyAttachmentRef } from "@langwatch/langy-contract";

/** How long one dispatch to the worker manager may take before it counts as unavailable. */
export const LANGY_AGENT_DISPATCH_TIMEOUT_MS = 60_000;

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
  disabledSkillIds?: string[];
};

export type LangyWorkerWarmInput = {
  projectId: string;
  actorUserId: string;
  conversationId: string;
  credentials: unknown;
  modelOverride?: string;
};

/** One image a turn hands the model, as base64 bytes; never logged. */
export type LangyWorkerImage = { name: string; mediaType: string; data: string };

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
  /** The user message's images, read into `images` before the request leaves (ADR-158). */
  imageRefs?: readonly LangyAttachmentRef[];
  images?: readonly LangyWorkerImage[];
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
