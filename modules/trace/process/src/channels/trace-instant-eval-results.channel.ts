import type { InstantEvalApi } from "@langwatch/instant-eval-contract";

/**
 * What trace asks instant-eval for its drawer: a trace's kept Instant Evals results (ADR-189
 * section 3). Bound to instant-eval's API, not a peer, since instant-eval depends on trace (§5).
 */
export type TraceInstantEvalResults = Pick<InstantEvalApi, "findResultsByTrace">;
