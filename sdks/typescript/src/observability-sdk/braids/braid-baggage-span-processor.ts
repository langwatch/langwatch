/**
 * Copies a braid's named baggage entries and their signature onto every span
 * on the called side (ADR-183 section 4).
 * @module braids/braid-baggage-span-processor
 */

import { propagation, type Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { assertBraidEntryKey, BRAID_SIGNATURE_KEY } from "./braid-wire-format";

/** Which baggage entries the called side copies onto its spans. */
export interface BraidOptions {
  /** Entry keys to copy, each matching `[A-Za-z0-9._-]{1,128}`. */
  copyEntries: string[];
}

/**
 * On span start, sets each named baggage entry, and `langwatch.signature`
 * when present, as a span attribute of the same name.
 */
export class BraidBaggageSpanProcessor implements SpanProcessor {
  private readonly keys: string[];

  constructor({ copyEntries }: BraidOptions) {
    for (const key of copyEntries) assertBraidEntryKey(key);
    this.keys = [...copyEntries, BRAID_SIGNATURE_KEY];
  }

  onStart(span: Span, parentContext: Context): void {
    const baggage = propagation.getBaggage(parentContext);
    if (!baggage) return;
    for (const key of this.keys) {
      const entry = baggage.getEntry(key);
      if (entry !== undefined) span.setAttribute(key, entry.value);
    }
  }

  onEnd(_span: ReadableSpan): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** The copy processor for a setup's `braids` option, or none. */
export function braidSpanProcessors(braids: BraidOptions | undefined): SpanProcessor[] {
  return braids?.copyEntries.length ? [new BraidBaggageSpanProcessor(braids)] : [];
}
