// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Whether a read was refused for want of permission, read structurally off the
 * serialised envelope: a refused reader is told who can tell them, not shown a
 * failure. Spec: specs/identity/organization-authentication-settings.feature
 */
export function isReadRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } | null }).data;
  return data?.code === "FORBIDDEN" || data?.httpStatus === 403;
}
