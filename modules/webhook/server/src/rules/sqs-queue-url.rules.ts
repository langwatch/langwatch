import type { ParsedSqsQueueUrl } from "../services/webhook-destination.service.ts";

/**
 * Queue URL admission: canonical Amazon SQS URLs only, no SSRF fence.
 */

/**
 * Canonical SQS URL patterns: regional, FIPS, China, legacy regional; no region-less form.
 */
const SQS_QUEUE_URL_PATTERNS: readonly RegExp[] = [
  // sqs.<region>.amazonaws.com[.cn] and sqs-fips.<region>.amazonaws.com
  /^https:\/\/sqs(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/(\d{12})\/([A-Za-z0-9_-]{1,80}(\.fifo)?)$/,
  // <region>.queue.amazonaws.com[.cn], the legacy regional form
  /^https:\/\/([a-z0-9-]+)\.queue\.amazonaws\.com(?:\.cn)?\/(\d{12})\/([A-Za-z0-9_-]{1,80}(\.fifo)?)$/,
];

export type SqsQueueUrlProblem = "shape" | "fifo";

export type SqsQueueUrlInspection =
  | { ok: true; parsed: ParsedSqsQueueUrl }
  | { ok: false; problem: SqsQueueUrlProblem };

export function inspectSqsQueueUrl(queueUrl: string): SqsQueueUrlInspection {
  const trimmed = queueUrl.trim();
  const match = SQS_QUEUE_URL_PATTERNS.reduce<RegExpExecArray | null>(
    (found, pattern) => found ?? pattern.exec(trimmed),
    null,
  );
  if (!match) return { ok: false, problem: "shape" };

  const [, region, accountId, queueName, fifoSuffix] = match;
  // Standard queues only. Our delivery contract is already at-least-once with
  // envelope-id dedup, which IS standard-queue semantics; we never promised
  // ordering; and a FIFO queue caps at 300 messages a second, well under what
  // a busy organization emits.
  if (fifoSuffix) return { ok: false, problem: "fifo" };

  return {
    ok: true,
    parsed: {
      queueUrl: trimmed,
      region: region!,
      accountId: accountId!,
      queueName: queueName!,
    },
  };
}

/** The parsed queue URL, or null when it is not one. For readers that
 *  already know the URL was admitted at save time. */
export function parseSqsQueueUrl(queueUrl: string): ParsedSqsQueueUrl | null {
  const inspection = inspectSqsQueueUrl(queueUrl);
  return inspection.ok ? inspection.parsed : null;
}

/** The host the SDK will dial for this queue, for proxy applicability. */
export function sqsHostFor(queueUrl: string): string {
  return /^https:\/\/([^/]+)\//.exec(queueUrl.trim())?.[1] ?? "";
}
