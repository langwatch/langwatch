/**
 * What to call somebody on screen.
 *
 * The name if they have one, and their address if they do not. Accounts
 * without a name are ordinary now — a passkey sign-up asks for none, an
 * identity provider may assert none — and the screens that name people were
 * interpolating the gap straight into their copy, which is how the header menu
 * came to read "null (sam@acme.com)".
 *
 * `beforeUserCreate` fills the column at the seam every creation path passes
 * through, so a new account always has one. This is for the accounts that
 * already exist and for the moment before a session has loaded: it fixes what
 * is on the screen rather than waiting for the data underneath to be corrected.
 *
 * Whitespace is not a name. A blank renders as an unexplained gap wherever a
 * person is listed, which is the same bug wearing a quieter face.
 */
export function displayNameFor({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}): string {
  return name?.trim() || email?.trim() || "";
}
