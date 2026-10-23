import { createHash } from "node:crypto";

/** 2^48: the first six bytes of the digest read as an integer, divided by this, land in [0, 1). */
const SAMPLE_SPACE = 2 ** 48;

/**
 * A trace's place in [0, 1) for one monitor, from a SHA-256 of the two ids.
 * The same trace and monitor always land in the same place, so a retry or a
 * redelivery makes the same sampling decision, and each monitor samples on its own.
 */
export function evaluationSamplePosition(input: { traceId: string; monitorId: string }): number {
  const digest = createHash("sha256").update(`${input.monitorId}\0${input.traceId}`).digest();

  return digest.readUIntBE(0, 6) / SAMPLE_SPACE;
}

/** Whether a monitor at sample rate `sample` evaluates this trace: 0 never does, 1 always does. */
export function isEvaluationSampled(input: {
  traceId: string;
  monitorId: string;
  sample: number;
}): boolean {
  return evaluationSamplePosition(input) < input.sample;
}
