/**
 * The model's clearing of long texts a process saw lately, so a text sent again and again (an
 * agent's system prompt on every call) is analysed once per process, not once per span.
 * Spec: modules/data-privacy/specs/span-pii-redaction.feature
 */

import { createHash } from "node:crypto";

/** Shorter texts are cheap to send again; only long ones are worth holding. */
export const PII_REDACTION_REPEAT_MIN_CHARACTERS = 2_000;
const REPEAT_TTL_MS = 10 * 60_000;
const REPEAT_MAX_ENTRIES = 256;

/** Everything the model's answer for one text depends on, besides the text itself. */
type RepeatScope = Readonly<{
  organizationId: string;
  piiRedactionLevel: string;
  entities: readonly string[];
  spareNamesAndPlaces: readonly boolean[] | undefined;
}>;

type Remembered = { cleared: string | null; expiresAt: number };

/** A batch split into what the process already holds and the texts still to send. */
export type RepeatRecall = Readonly<{
  /** Indexes into the batch's texts still to send, in order. */
  pending: readonly number[];
  /** The batch's clearing once `pending`'s own clearing is known, in the same order. */
  merge: (clearedPending: readonly (string | null)[]) => (string | null)[];
}>;

export class PiiRedactionRepeatsService {
  static create(input: { now: () => number }): PiiRedactionRepeatsService {
    return new PiiRedactionRepeatsService(input.now);
  }

  readonly #entries = new Map<string, Remembered>();

  private constructor(private readonly now: () => number) {}

  recall({ scope, texts }: { scope: RepeatScope; texts: readonly string[] }): RepeatRecall {
    const known = new Map<number, string | null>();
    const pending: number[] = [];
    texts.forEach((text, index) => {
      const hit = isHeld(text) ? this.#hit(keyOf({ scope, text, index })) : undefined;
      if (hit) known.set(index, hit.cleared);
      else pending.push(index);
    });
    return {
      pending,
      merge: (clearedPending) => {
        if (clearedPending.length !== pending.length) {
          throw new Error("the model's clearing does not answer every text sent");
        }
        return texts.map((_, index) =>
          known.has(index)
            ? (known.get(index) ?? null)
            : (clearedPending[pending.indexOf(index)] ?? null),
        );
      },
    };
  }

  /** Holds each text `held` marks; `cleared` must answer every text, in order. */
  remember({
    scope,
    texts,
    cleared,
    held,
  }: {
    scope: RepeatScope;
    texts: readonly string[];
    cleared: readonly (string | null)[];
    held: readonly boolean[];
  }): void {
    if (cleared.length !== texts.length) return;
    texts.forEach((text, index) => {
      if (!isHeld(text) || !held[index]) return;
      const key = keyOf({ scope, text, index });
      this.#entries.delete(key);
      this.#entries.set(key, {
        cleared: cleared[index] ?? null,
        expiresAt: this.now() + REPEAT_TTL_MS,
      });
      if (this.#entries.size > REPEAT_MAX_ENTRIES) {
        const oldest = this.#entries.keys().next().value;
        if (oldest !== undefined) this.#entries.delete(oldest);
      }
    });
  }

  #hit(key: string): Remembered | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    this.#entries.delete(key);
    if (hit.expiresAt <= this.now()) return undefined;
    this.#entries.set(key, hit);
    return hit;
  }
}

/** Whether a text is long enough to be held. */
function isHeld(text: string): boolean {
  return text.length >= PII_REDACTION_REPEAT_MIN_CHARACTERS;
}

/** One text's key in its scope. */
function keyOf({
  scope,
  text,
  index,
}: {
  scope: RepeatScope;
  text: string;
  index: number;
}): string {
  const spared = scope.spareNamesAndPlaces?.[index] ?? false;
  const entities = scope.entities.toSorted().join(",");
  return createHash("sha256")
    .update(
      `${scope.organizationId}\u0000${scope.piiRedactionLevel}\u0000${entities}\u0000${spared}\u0000`,
    )
    .update(text)
    .digest("hex");
}
