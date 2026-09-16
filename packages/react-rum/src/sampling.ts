/**
 * Head sampling for browser telemetry — the volume lever, since frontend telemetry scales with
 * tabs open, not requests served. Per SESSION, not per trace: RUM needs whole visits, and an
 * unsampled browser trace makes the server's `ParentBasedSampler` drop its spans too. See ADR-058.
 */

import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import {
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from "@opentelemetry/sdk-trace-base";

import { currentSessionId } from "./session.ts";

const SAMPLED: SamplingResult = {
  decision: SamplingDecision.RECORD_AND_SAMPLED,
};
const DROPPED: SamplingResult = { decision: SamplingDecision.NOT_RECORD };

/**
 * Samples whole sessions at `ratio`. The decision is derived from the session
 * id rather than drawn per trace, so every trace in a visit agrees with no
 * state kept; a rotated session (see {@link currentSessionId}) redraws as the new visit it is.
 */
export class SessionRatioSampler implements Sampler {
  private readonly ratio: number;
  /** Draw for a browser that has no session id to derive one from. */
  private readonly fallback: number;
  private cached?: { sessionId: string; sampled: boolean };

  constructor(ratio: number, fallback = Math.random()) {
    // A ratio outside [0, 1] is a misconfiguration, and the safe reading of a
    // nonsense value is "record everything" — under-collecting silently is
    // harder to notice than over-collecting.
    this.ratio = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 1;
    this.fallback = fallback;
  }

  shouldSample(
    _context: Context,
    _traceId: string,
    _spanName: string,
    _spanKind: SpanKind,
    _attributes: Attributes,
    _links: Link[],
  ): SamplingResult {
    return this.isSessionSampled() ? SAMPLED : DROPPED;
  }

  private isSessionSampled(): boolean {
    if (this.ratio >= 1) return true;
    if (this.ratio <= 0) return false;

    // Storage can be unavailable (Safari private mode), in which case there is
    // no session to be consistent about and one draw per page is the best
    // available approximation of a visit.
    const sessionId = currentSessionId();
    if (!sessionId) return this.fallback < this.ratio;

    if (this.cached?.sessionId !== sessionId) {
      this.cached = {
        sessionId,
        sampled: unitIntervalOf(sessionId) < this.ratio,
      };
    }
    return this.cached.sampled;
  }

  toString(): string {
    return `SessionRatioSampler{${this.ratio}}`;
  }
}

/**
 * The sampler the browser provider uses: session ratio at the root, parent
 * decision everywhere else, so one visit is sampled or dropped as a whole.
 */
export function createBrowserSampler({ ratio }: { ratio: number }): Sampler {
  return new ParentBasedSampler({ root: new SessionRatioSampler(ratio) });
}

/**
 * Maps a session id into [0, 1). Session ids are 16 random bytes rendered as
 * hex, so the leading 32 bits are already uniform and no hashing is needed —
 * `parseInt` of the first eight characters is the whole of it.
 */
function unitIntervalOf(sessionId: string): number {
  const leading = Number.parseInt(sessionId.slice(0, 8), 16);
  if (!Number.isFinite(leading)) return 1; // Unreadable id: do not sample.
  return leading / 0x1_0000_0000;
}
