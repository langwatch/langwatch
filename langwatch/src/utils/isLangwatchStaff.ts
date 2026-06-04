export function isLangwatchStaff(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith("@langwatch.ai");
}
