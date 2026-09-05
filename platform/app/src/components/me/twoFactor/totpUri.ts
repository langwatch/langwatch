/**
 * The typed-in half of a setup.
 *
 * A person whose camera cannot see the screen — a desktop authenticator, a
 * locked-down phone, somebody who simply prefers typing — needs the same
 * value the scannable code carries, and it is sitting in the setup link the
 * two-factor plugin hands back. Reading it here rather than asking for it
 * separately keeps the two halves of the screen provably the same secret.
 *
 * Returns null for anything that is not a setup link we recognise, and the
 * screen then offers the scannable code alone rather than an empty field.
 */
export function sharedSecretFrom(
  setupUri: string | null | undefined,
): string | null {
  if (!setupUri) return null;
  try {
    const parsed = new URL(setupUri);
    const secret = parsed.searchParams.get("secret");
    return secret && secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

/**
 * The secret, grouped so a person can read it aloud or type it without losing
 * their place. Four at a time is what every authenticator's own setup screen
 * uses, and it is the difference between a value somebody can transcribe and
 * one they give up on.
 */
export function groupedSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}
