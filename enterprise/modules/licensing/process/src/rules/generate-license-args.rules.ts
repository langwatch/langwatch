import { MAX_STATED_SEATS } from "@langwatch/plans";
import { type Instant, Temporal } from "@langwatch/time";

import type { LicenseMintRequest } from "../services/license-mint.service.ts";

const USAGE =
  "generate-license --org-id <organizationId> [--plan ENTERPRISE|GROWTH|PRO] [--max-members <N>]" +
  " [--max-members-lite <N>] [--max-members-developer <N>] [--max-messages-per-month <N>]" +
  " [--expires-at <YYYY-MM-DD>]" +
  " [--email <addr>]";

/** A quota is a whole number; "50GB" or "1.9" is a typo, never 50 or 1. */
function parseQuota(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a whole number, got: ${value}\n${USAGE}`);
  }
  return parsed;
}

/** A seat count fits the 32-bit seat column the registry stores it in. */
function parseSeats(flag: string, value: string): number {
  const parsed = parseQuota(flag, value);
  if (parsed > MAX_STATED_SEATS) {
    throw new Error(`${flag} can be at most ${MAX_STATED_SEATS}, got: ${value}\n${USAGE}`);
  }
  return parsed;
}

/** A calendar date read as midnight UTC; "2025-02-31" is refused, never rolled forward. */
function parseExpiresAt(value: string): Instant {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(value);
    return Temporal.Instant.from(`${value}T00:00:00Z`);
  } catch {
    throw new Error(`--expires-at must be a calendar date as YYYY-MM-DD, got: ${value}\n${USAGE}`);
  }
}

/** Main's generate-license flags, read into a mint request; the plan defaults to ENTERPRISE. */
export function parseGenerateLicenseArgs(args: readonly string[]): LicenseMintRequest {
  let organizationId: string | undefined;
  const request: Omit<LicenseMintRequest, "organizationId"> & { planType: string } = {
    planType: "ENTERPRISE",
  };
  const fields: Record<string, (value: string) => void> = {
    "--org-id": (value) => {
      organizationId = value;
    },
    "--plan": (value) => Object.assign(request, { planType: value.toUpperCase() }),
    "--max-members": (value) =>
      Object.assign(request, { maxMembers: parseSeats("--max-members", value) }),
    "--max-members-lite": (value) =>
      Object.assign(request, { maxMembersLite: parseSeats("--max-members-lite", value) }),
    "--max-members-developer": (value) =>
      Object.assign(request, {
        maxMembersDeveloper: parseSeats("--max-members-developer", value),
      }),
    "--max-messages-per-month": (value) =>
      Object.assign(request, {
        maxMessagesPerMonth: parseQuota("--max-messages-per-month", value),
      }),
    "--expires-at": (value) => Object.assign(request, { expiresAt: parseExpiresAt(value) }),
    "--email": (value) => Object.assign(request, { email: value }),
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index] ?? "";
    const value = args[index + 1];
    const apply = fields[flag];
    if (apply === undefined) continue;
    if (value === undefined) throw new Error(`${flag} requires a value\n${USAGE}`);
    apply(value);
    index++;
  }
  if (organizationId === undefined) throw new Error(`--org-id is required\n${USAGE}`);
  return { ...request, organizationId };
}
