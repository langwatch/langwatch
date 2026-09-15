/**
 * How the product says a person's name back to them. The stored profile name may be a full
 * name, single word, or an email an identity provider filled in for them — a surface wants the
 * short human half, never a bare email, which reads as a database row talking, not the product.
 */

/**
 * The person's first name, or null when the profile holds nothing worth
 * addressing them by.
 *
 * Null rather than a placeholder, because the right thing to put in the gap
 * differs by surface: the home greeting drops the name from its sentence, and
 * a message label falls back to the generic role.
 */
export const displayFirstName = ({ name }: { name: string | null | undefined }): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  // An email address is an identifier, not a name. Providers that have no real
  // name for a user often store one in this field, and it must never be what a
  // surface calls them.
  if (trimmed.includes("@")) return null;

  // Any whitespace, not just a space: a name pasted from a profile can carry a
  // non-breaking space or a tab between its parts, and splitting on " " alone
  // returns the whole string as the "first" name.
  return trimmed.split(/\s+/)[0] ?? null;
};
