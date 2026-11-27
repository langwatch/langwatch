/**
 * The platform ops functions' pure decisions (ADR-202): stored words and ids collapse to "other"
 * unless they are plain, an upgrade error's free text becomes a code, and the 12 UTC months.
 * Spec: modules/staff-access/specs/staff-access-functions-platform.feature
 */
import type { Instant } from "@langwatch/time";

const OTHER = "other";
const PLAIN_WORD = /^[a-z][a-z0-9_-]{0,39}$/;
const RELEASE = /^[0-9A-Za-z.+-]{1,64}$/;
const IMAGE_TAG = /^[A-Za-z0-9._-]{1,128}$/;
const LEADING_CODE = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?=$|[:\s])/;

/** A stored role, state or mode as one plain lower-case word, else "other". */
export function plainWordOf(value: string): string {
  return PLAIN_WORD.test(value) ? value : OTHER;
}

/** Counts keyed by stored word, re-keyed by {@link plainWordOf}; words that collapse are summed. */
export function countsByPlainWord(
  counts: Readonly<Record<string, number>>,
): Record<string, number> {
  const summed = new Map<string, number>();
  for (const [word, count] of Object.entries(counts)) {
    const plain = plainWordOf(word);
    summed.set(plain, (summed.get(plain) ?? 0) + count);
  }
  return Object.fromEntries(summed);
}

export function releaseOf(value: string): string {
  return RELEASE.test(value) ? value : OTHER;
}

/** An image reference's tag, without registry, repository or digest; digest-only is "other". */
export function imageTagOf(image: string): string {
  const [reference = "", digest] = image.split("@");
  const name = reference.slice(reference.lastIndexOf("/") + 1);
  const colon = name.lastIndexOf(":");
  if (colon < 0) return name === "" || digest !== undefined ? OTHER : "latest";
  const tag = name.slice(colon + 1);
  return IMAGE_TAG.test(tag) ? tag : OTHER;
}

/** A step's error text as a code: its leading snake_case code, a known shape, else "other". */
export function upgradeErrorCodeOf(lastError: string): string {
  const text = lastError.trim();
  if (text.startsWith("failed on ")) return "targets_failed";
  if (text.includes("declares no such step")) return "step_not_declared";
  return LEADING_CODE.exec(text)?.[1] ?? OTHER;
}

export type UtcMonth = Readonly<{ key: string; since: number; until: number }>;

/** The `count` UTC months up to the one `at` falls in, oldest first; the last ends at `at`. */
export function utcMonthsUntil({ at, count }: { at: Instant; count: number }): UtcMonth[] {
  const current = at.toZonedDateTimeISO("UTC").with({ day: 1 }).startOfDay();
  return Array.from({ length: count }, (_, index) => {
    const start = current.subtract({ months: count - 1 - index });
    const next = start.add({ months: 1 });
    const startMs = start.epochMilliseconds;
    return {
      key: `${start.year}-${String(start.month).padStart(2, "0")}`,
      since: startMs,
      until: Math.min(next.epochMilliseconds, at.epochMilliseconds),
    };
  });
}
