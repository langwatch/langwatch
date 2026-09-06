/**
 * `ADMIN_EMAILS`, parsed the way the live platform-admin check reads it:
 * comma-separated, trimmed, lowercased, blanks dropped. The one place this
 * parse may be written for the platform (system-migrations' cutover
 * composition reads it from here too, via `runtime.ts`); the package side
 * (`@langwatch/authz-server`'s cutover migration) cannot import this `ee/`
 * module and keeps its own copy, pinned against this one by a test - see
 * `__tests__/isAdmin.unit.test.ts`.
 */
export const adminEmailList = (): string[] =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

export const isAdmin = (user: { email?: string | null }) => {
  if (!user?.email) return false;
  const normalizedEmail = user.email.toLowerCase().trim();
  return adminEmailList().includes(normalizedEmail);
};
