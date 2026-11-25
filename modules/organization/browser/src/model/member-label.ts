/** A member as a picker shows them: "Name (email)", or whichever half the account has. */
export function memberLabel({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}): string {
  if (name && email) return `${name} (${email})`;
  return name || email || "Unknown user";
}
