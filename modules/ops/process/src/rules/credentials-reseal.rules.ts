import type { ServingRosterEntry } from "@langwatch/upgrade";
/**
 * Moves sealed values inside stored text from the previous key to the current one.
 * A sealed value is found by its shape wherever it sits: a whole column, a string
 * inside a JSON document, or the tail of a prefixed value such as `enc:v1:<sealed>`.
 */

/** What the re-seal needs of a cipher keyed by exactly one key. */
export type CredentialCipher = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

/**
 * The cipher's hex `iv:ciphertext:tag`, and the base64url `iv.tag.ciphertext` it
 * still reads. Postgres regular-expression syntax and JavaScript's agree on both.
 */
export const SEALED_VALUE_PATTERN =
  "[0-9a-f]{24}:[0-9a-f]*:[0-9a-f]{32}|[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.";

const SEALED_VALUE =
  /[0-9a-f]{24}:[0-9a-f]*:[0-9a-f]{32}(?![0-9a-f])|[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*/g;

type ResealedText = Readonly<{
  /** The text with every value the previous key opened sealed under the current key. */
  text: string;
  resealed: number;
  alreadyCurrent: number;
  /** Shaped like a sealed value, and opened by neither key. Left as found. */
  undecryptable: number;
}>;

type Opening = { opened: true; plaintext: string } | { opened: false };

function open({ cipher, sealed }: { cipher: CredentialCipher; sealed: string }): Opening {
  try {
    return { opened: true, plaintext: cipher.decrypt(sealed) };
  } catch {
    return { opened: false };
  }
}

/**
 * The current key is tried first, so a value already moved is never touched and a
 * second pass over the same text changes nothing.
 */
export function resealText({
  text,
  current,
  previous,
}: {
  text: string;
  current: CredentialCipher;
  previous: CredentialCipher | undefined;
}): ResealedText {
  const counts = { resealed: 0, alreadyCurrent: 0, undecryptable: 0 };
  const moved = text.replace(SEALED_VALUE, (sealed) => {
    if (open({ cipher: current, sealed }).opened) {
      counts.alreadyCurrent += 1;
      return sealed;
    }
    const underPrevious: Opening = previous
      ? open({ cipher: previous, sealed })
      : { opened: false };
    if (!underPrevious.opened) {
      counts.undecryptable += 1;
      return sealed;
    }
    counts.resealed += 1;
    return current.encrypt(underPrevious.plaintext);
  });

  return { text: moved, ...counts };
}

/**
 * The live processes that do not state every given key, so would fail on a value sealed under one
 * of them; the re-seal waits while any is listed (Alex, 2026-10-09).
 */
export function processesNotAccepting({
  roster,
  fingerprints,
}: {
  roster: readonly Pick<ServingRosterEntry, "processId" | "credentialKeys">[];
  fingerprints: readonly string[];
}): string[] {
  return roster
    .filter(
      (row) => !fingerprints.every((fingerprint) => row.credentialKeys?.includes(fingerprint)),
    )
    .map((row) => row.processId);
}
