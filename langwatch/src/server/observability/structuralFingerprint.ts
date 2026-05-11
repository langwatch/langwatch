import { createHash } from "crypto";

/**
 * Structural fingerprint of a trace — a stable hash over the SHAPE of
 * the trace (span names, kinds, attribute key sets), NOT over the
 * content. Output of {@link computeStructuralFingerprint}.
 *
 * Post-2026-05-11 incident follow-up: the loop that took down the
 * cluster produced traces where the content varied (every LLM call
 * has a different output string) but the structure was identical
 * (same workflow shape repeated thousands of times). Content hashing
 * would have missed it; structural hashing catches it.
 *
 * Trade-off: legitimately homogeneous workloads — regression suites,
 * cron jobs hitting the same endpoint — will produce a tight cluster
 * of identical fingerprints too. That's why fingerprint-loop alerts
 * additionally require (a) a concentration threshold (>=80% of tenant
 * volume) and (b) a high absolute rate (>=100/min). Steady homogeneous
 * traffic at low rates passes; runaway loops at thousands/min trigger.
 */
export type StructuralFingerprint = string; // 40-char hex sha1

export interface FingerprintInputSpan {
  name: string;
  kind?: number | null;
  attributeKeys: string[];
}

/**
 * Compute a structural fingerprint over a list of spans. Sort-stable,
 * content-blind, deterministic. Keys only — never values — so LLM
 * non-determinism in outputs does NOT affect the fingerprint.
 *
 * Spans are first canonicalised to `<name>:<kind>:<sorted-attr-keys>`
 * then the sorted list is itself joined and hashed. Sorting at both
 * levels means span-arrival order doesn't matter; the same workflow
 * always hashes to the same value.
 */
export function computeStructuralFingerprint(
  spans: FingerprintInputSpan[],
): StructuralFingerprint {
  if (spans.length === 0) return "empty";
  const parts: string[] = [];
  for (const span of spans) {
    const keys = [...span.attributeKeys].sort().join(",");
    const kind = span.kind ?? 0;
    parts.push(`${span.name}:${kind}:${keys}`);
  }
  parts.sort();
  return createHash("sha1").update(parts.join("|")).digest("hex");
}
