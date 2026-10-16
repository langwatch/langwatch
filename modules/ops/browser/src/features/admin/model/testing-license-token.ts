/** A testing-license token as an ops manager reads it (ADR-180): never the token itself.
 * Declared here, not derived from `RouterOutputs`: model stays pure and
 * behavior depends on it, never the reverse. */
export interface TestingLicenseToken {
  id: string;
  kind: "personal" | "service";
  name: string | null;
  ownerUserId: string;
  ownerName?: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedById: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "revoked";
}

export const TOKEN_STATUS_COLORS: Record<TestingLicenseToken["status"], string> = {
  active: "green",
  expired: "orange",
  revoked: "red",
};

export const DEFAULT_SERVICE_TOKEN_DAYS = 90;
export const MAX_SERVICE_TOKEN_DAYS = 365;

export interface ServiceTokenDraft {
  name: string;
  expiresInDays: string;
}

export type ServiceTokenProblems = Partial<Record<keyof ServiceTokenDraft, string>>;

export function emptyServiceTokenDraft(): ServiceTokenDraft {
  return { name: "", expiresInDays: String(DEFAULT_SERVICE_TOKEN_DAYS) };
}

export function serviceTokenProblems(draft: ServiceTokenDraft): ServiceTokenProblems {
  const problems: ServiceTokenProblems = {};
  if (!draft.name.trim()) problems.name = "Enter a name for the token.";
  const days = Number(draft.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_SERVICE_TOKEN_DAYS) {
    problems.expiresInDays = `Enter a whole number of days from 1 to ${MAX_SERVICE_TOKEN_DAYS}.`;
  }
  return problems;
}

/** The label a token row shows: a service token's name, or whose personal token it is. */
export function tokenDisplayName(token: TestingLicenseToken): string {
  return token.name ?? "Personal token";
}
