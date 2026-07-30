import type { ContributionFacts } from "../schema";

/**
 * The coding-agent vocabulary port: which agent produced a signal, what its
 * conversation key is, and which scalar values to lift off it. Injected
 * rather than reimplemented — the per-vendor detection rules live in the
 * normalization service, not in the event-sourcing layer.
 */
export interface CodingAgentDetectionPort {
  /** The conversation key, if this signal carries one under any of the vocabulary's known spellings. */
  resolveConversationKey(attrs: Record<string, unknown>): string | null;

  /** Which agent produced this signal — `"unknown"` when nothing in the registry matches. */
  detectAgent(signal: {
    readonly scopeName?: string | null;
    readonly recordName?: string | null;
    readonly serviceName?: string | null;
  }): string;

  /** Whether a span's raw wire name belongs to the coding-agent vocabulary at all — the enqueue-time gate. */
  isCodingAgentSpanName(rawName: string): boolean;

  /** The lifted scalar vocabulary off one span's attributes. */
  liftSpanFacts(attrs: Record<string, unknown>): ContributionFacts;

  /**
   * The lifted scalar vocabulary off one log record, or `null` when the
   * record is not a coding agent's at all — doubling as the gate, exactly as
   * the old pipeline's `liftCodingAgentLogFacts` did.
   */
  liftLogFacts(args: {
    readonly scopeName: string | null | undefined;
    readonly attributes: Record<string, unknown>;
  }): ContributionFacts | null;

  /** Whether a metric's raw wire name belongs to the coding-agent vocabulary at all — the enqueue-time gate. */
  isCodingAgentMetricName(rawName: string): boolean;

  /** The lifted scalar identity attributes off one metric point. */
  liftMetricAttributes(attrs: Record<string, unknown>): ContributionFacts;
}
