import type { ParsedSqsQueueUrl } from "./webhook-destination.service";

/**
 * Queue URL admission, and everything that is read off a queue URL.
 *
 * The SSRF fence in `urlPolicy` never sees this URL, because we do not dial
 * it: the AWS SDK does, from the URL plus a signature. So the fence is
 * replaced by a shape: the URL must be a canonical Amazon SQS queue URL and
 * nothing else, which is also what makes the region and the owning account
 * readable from it rather than configured beside it, where they could
 * disagree with the queue.
 */

/**
 * Every spelling AWS actually serves a queue URL under:
 *
 * - `https://sqs.<region>.amazonaws.com/<account>/<queue>`, the current form;
 * - `sqs.<region>.amazonaws.com.cn`, the China partitions;
 * - `sqs-fips.<region>.amazonaws.com`, the FIPS endpoints, which a regulated
 *   customer is required to use and which the plain pattern would have
 *   refused as "not an Amazon SQS queue URL";
 * - `https://<region>.queue.amazonaws.com/<account>/<queue>`, the legacy
 *   regional form that older consoles and SDKs still hand out.
 *
 * The region-less legacy form, `https://queue.amazonaws.com/<account>/<queue>`,
 * is refused. The region is read off the URL precisely so it cannot disagree
 * with the queue, and that URL carries no region to read: accepting it would
 * mean guessing `us-east-1` and writing a customer's events to whatever queue
 * of that name lives there. Re-copy the queue URL from the SQS console, which
 * gives the current form.
 *
 * Queue names are up to 80 characters of alphanumerics, hyphens and
 * underscores; a FIFO queue adds the `.fifo` suffix, which is matched here so
 * it can be refused with a sentence about FIFO rather than one about the URL
 * being unrecognizable.
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
  try {
    return new URL(queueUrl).hostname;
  } catch {
    return "";
  }
}
