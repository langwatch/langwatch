/** Whether an address is on the operator list (`ADMIN_EMAILS`), case- and space-blind. */
export function isPlatformOperatorEmail({
  adminEmails,
  email,
}: {
  adminEmails: readonly string[];
  email: string | null;
}): boolean {
  if (email == null) return false;
  const normalized = email.trim().toLowerCase();
  return adminEmails.some((admin) => admin.trim().toLowerCase() === normalized);
}
