import type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./langy-conversation-process.port";

/** Worker dispatch budget used by both the worker adapter and process lease. */
export const LANGY_AGENT_DISPATCH_TIMEOUT_MS = 60_000;

/** Margin kept between a worker dispatch timeout and its process lease. */
export const LANGY_OUTBOX_LEASE_MARGIN_MS = 30_000;

/** The outbox lease must outlive one accepted worker dispatch. */
export const LANGY_OUTBOX_LEASE_DURATION_MS =
  LANGY_AGENT_DISPATCH_TIMEOUT_MS + LANGY_OUTBOX_LEASE_MARGIN_MS;

export interface LangyWorkerDispatchPort {
  dispatchTurn(params: LangyWorkerDispatchIntent & { projectId: string }): Promise<void>;
}

export interface LangyTitleGenerationPort {
  generateTitle(params: LangyGenerateTitleIntent & { projectId: string }): Promise<void>;
}

export interface LangyEffectPorts {
  workerDispatch: LangyWorkerDispatchPort;
  titleGeneration: LangyTitleGenerationPort;
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
