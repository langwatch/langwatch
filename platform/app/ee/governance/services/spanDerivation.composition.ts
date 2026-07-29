// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Layer-0 composition root (ADR-082) for the stateless span-derivation
 * services the governance stream projections and the `virtualKeyLastUsed`
 * subscriber all read spans through.
 *
 * **Why a module and not a `Deps` member.** ADR-082 adds layer 0 so that
 * construction has an *address*; a `const x = new Y()` at the top of four
 * unrelated domain files is construction with no address, and it had already
 * produced four `CanonicalizeSpanAttributesService` instances (seventeen
 * extractor objects each) doing identical work. Threading them through each
 * consumer's `Deps` would give them an address too, but it widens four
 * signatures to inject values no test would ever substitute: all three are
 * pure functions of a span with no I/O, no clock and no configuration, so a
 * seam there buys nothing a direct call does not already give. A single
 * named module is the address; this file is it, and its membership test —
 * *does it only construct?* — is satisfied on every line.
 *
 * Shared instances are safe because all three are stateless. The one mutator
 * in reach is `CanonicalizeSpanAttributesService.registerExtractor`, which
 * has no caller anywhere in the tree; if one ever appears, it must not be
 * pointed at this instance.
 */

import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { SpanCostService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service";
import { SpanStatusService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-status.service";

/**
 * OTLP span → `NormalizedSpan`. Not cheap: it opens a tracer span and runs
 * every canonicalisation extractor over the whole attribute set, prompts and
 * completions included. Consumers gate on a raw-wire predicate first.
 */
export const spanNormalizationPipelineService =
  new SpanNormalizationPipelineService(new CanonicalizeSpanAttributesService());

/**
 * Cost, tokens and model resolution. The SAME instance semantics as the
 * trace-summary and analytics folds use, which is what keeps a governance
 * spend figure equal to the trace totals the same customer sees on /traces.
 */
export const spanCostService = new SpanCostService();

/** Error/OK classification for one span. */
export const spanStatusService = new SpanStatusService();
