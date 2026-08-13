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
 * `https://sqs.<region>.amazonaws.com/<12-digit account>/<queue name>`, and
 * its China partition spelling. Queue names are up to 80 characters of
 * alphanumerics, hyphens and underscores; a FIFO queue adds the `.fifo`
 * suffix, which is matched here so it can be refused with a sentence about
 * FIFO rather than one about the URL being unrecognizable.
 */
const SQS_QUEUE_URL_PATTERN =
  /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/(\d{12})\/([A-Za-z0-9_-]{1,80}(\.fifo)?)$/;

export interface ParsedSqsQueueUrl {
  queueUrl: string;
  region: string;
  accountId: string;
  queueName: string;
}

export type SqsQueueUrlProblem = "shape" | "fifo";

export type SqsQueueUrlInspection =
  | { ok: true; parsed: ParsedSqsQueueUrl }
  | { ok: false; problem: SqsQueueUrlProblem };

export function inspectSqsQueueUrl(queueUrl: string): SqsQueueUrlInspection {
  const match = SQS_QUEUE_URL_PATTERN.exec(queueUrl.trim());
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
      queueUrl: queueUrl.trim(),
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
