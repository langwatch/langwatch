/**
 * The typed-in half of a setup: the same secret the scannable code carries,
 * read out of the one setup link so the two halves cannot disagree.
 */

/** The setup key, or undefined for anything that is not a setup link we recognise. */
export function extractSetupKey(setupUri: string): string | undefined {
  try {
    const key = new URL(setupUri).searchParams.get("secret");
    return key && key.length > 0 ? key : void 0;
  } catch {
    return void 0;
  }
}

/** Four at a time, as every authenticator's own setup screen groups it. */
export function groupSetupKey(key: string): string {
  return (key.match(/.{1,4}/g) ?? [key]).join(" ");
}
