/**
 * Head sampling for browser telemetry — the volume lever.
 *
 * Frontend telemetry is larger and spikier than backend telemetry: it scales
 * with tabs open rather than with requests served, and it is paid for in Tempo
 * storage and collector CPU. Always-on is the right default for a small
 * internal population and the wrong one at scale, so the ratio is
 * configuration, not a constant.
 *
 * **Sampling is per session, not per trace.** The obvious sampler
 * (`TraceIdRatioBasedSampler`) decides independently for every trace, which at
 * 10% gives a tenth of the traces from every visit — enough to bill for and
 * never enough to read. The question RUM answers is "what was this person
 * doing when it broke", and answering it needs whole visits. So the ratio is a
 * ratio of *sessions*: a sampled session is complete, and an unsampled one
 * costs nothing at all.
 *
 * **A browser decision is final for the whole stack.** Head sampling
 * propagates: an unsampled browser trace arrives at the server with the sampled
 * flag clear and the server's `ParentBasedSampler` drops its spans too. That is
 * the intended behaviour — a half trace is worse than none — but it means the
 * ratio here reduces *backend* trace volume for browser-initiated work as well.
 * Server work with no browser parent (workers, webhooks, the API) is untouched.
 *
 * Retention biased toward sessions that errored or were slow is a better answer
 * than a flat ratio, and it is tail sampling: it needs the collector to hold a
 * trace until it is complete, which the collector is not configured to do.
 * Until it is, this is the lever. See ADR-058.
 */

import type {
  Attributes,
  Context,
  Link,
  SpanKind,
} from "@opentelemetry/api";
import {
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from "@opentelemetry/sdk-trace-base";

import { currentSessionId } from "./session";

const SAMPLED: SamplingResult = {
  decision: SamplingDecision.RECORD_AND_SAMPLED,
};
const DROPPED: SamplingResult = { decision: SamplingDecision.NOT_RECORD };

/**
 * Samples whole sessions at `ratio`.
 *
 * The decision is derived from the session id rather than drawn per trace, so
 * every trace in a visit agrees without any state to keep, and a session that
 * rotates (see {@link currentSessionId}) is re-drawn as the new visit it is.
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
