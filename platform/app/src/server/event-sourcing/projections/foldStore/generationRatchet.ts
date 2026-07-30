import type { FoldCodec, VersionedRow } from "./foldCodec";

/**
 * What a fold store's round-trip looked like the last time someone declared a
 * shape for it: how many shapes it had declared, and a fingerprint of the
 * details its decoder reads back.
 */
export interface RecordedGeneration {
  /** How many generations the codec declared. */
  readonly generations: number;
  /** {@link FoldCodec.readsFingerprint} at that point. */
  readonly reads: string;
}

export interface RatchetSubject {
  readonly name: string;
  readonly codec: FoldCodec<unknown, VersionedRow>;
}

/**
 * The discipline problem the generation ladder cannot solve on its own: someone
 * edits `decode` to read one more persisted detail and does not declare a new
 * shape. Nothing breaks in test — every row the test writes is written by the
 * same build — and in production every row committed before that deploy now
 * decodes one detail short, silently, with the current stamp on it saying it is
 * fine.
 *
 * So the fingerprint of what a decoder reads back is RATCHETED, the way this
 * repo ratchets its other "you may not quietly widen this" lists: the recorded
 * value is checked in, and changing what a fold reads back without declaring a
 * generation for it fails.
 *
 * Deliberately one-directional. Declaring a new generation without changing
 * `reads` is ordinary and allowed — a shape can change for reasons a column
 * list does not capture (a fold bug being corrected, a value's meaning
 * changing). What is refused is the reverse: the reads moving underneath a
 * stamp that stayed still.
 *
 * @throws when a subject's reads changed without its generation count growing,
 *   when a subject has no recorded entry, or when the record names a subject
 *   that no longer exists.
 */
export function assertGenerationRatchet({
  subjects,
  recorded,
}: {
  subjects: readonly RatchetSubject[];
  recorded: Readonly<Record<string, RecordedGeneration>>;
}): void {
  const problems: string[] = [];

  for (const subject of subjects) {
    const entry = recorded[subject.name];
    const generations = subject.codec.generations.length;
    const reads = subject.codec.readsFingerprint;

    if (!entry) {
      problems.push(
        `"${subject.name}" declares a fold store round-trip with no recorded generation. ` +
          `Add { generations: ${generations}, reads: "${reads}" } so a later change to what it reads back cannot pass unnoticed.`,
      );
      continue;
    }

    if (entry.reads === reads) continue;

    if (generations > entry.generations) {
      // The paired edit: reads changed AND a shape was declared for it. The
      // record is stale, not wrong — it is updated in the same commit.
      problems.push(
        `"${subject.name}" declared generation ${generations} but its recorded reads fingerprint is still "${entry.reads}". ` +
          `Update its record to { generations: ${generations}, reads: "${reads}" }.`,
      );
      continue;
    }

    problems.push(
      `"${subject.name}" changed what it reads back (recorded "${entry.reads}", now "${reads}") while still declaring ` +
        `${generations} generation${generations === 1 ? "" : "s"}. Rows committed before this change do not carry the new ` +
        `read-back details, and nothing on them says so — they would decode short and be re-committed under the same stamp. ` +
        `Declare a new generation for the change, raise readBackSince to it, and record { generations: ${generations + 1}, reads: "${reads}" }.`,
    );
  }

  const declared = new Set(subjects.map((subject) => subject.name));
  for (const name of Object.keys(recorded)) {
    if (declared.has(name)) continue;
    problems.push(
      `"${name}" has a recorded generation but no fold store declares it — delete the record, or the ratchet is guarding nothing.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Fold store generation ratchet:\n- ${problems.join("\n- ")}`,
    );
  }
}
