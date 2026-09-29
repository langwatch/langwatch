/**
 * The exact report this install would send right now, for the page that
 * shows it and the command that prints it
 * (specs/self-hosting/checkup/checkup.feature, "What we send").
 *
 * The same collector the sender calls, with the same switches, so what a
 * customer reads on the page is what leaves the install and not a
 * description of it. The one difference is the identity: the page reads and
 * never mints, so an install that has never reported shows a placeholder
 * where the sender would mint a UUID.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { USAGE_REPORT_SCHEMA_VERSION } from "~/server/usage-report/dictionary";

export interface UsageReportSwitchState {
  /** The optional category is sent. Off means the report shrinks to standard and operational fields. */
  readonly optional: boolean;
  /** The hostname is sent. */
  readonly hostname: boolean;
}

export interface UsageReportPreview {
  /** The payload, exactly as it would be posted. */
  readonly payload: Record<string, unknown>;
  readonly switches: UsageReportSwitchState;
  /** Where it goes. */
  readonly endpoint: string;
  /** DISABLE_USAGE_STATS is set: the payload is what would go, and it does not. */
  readonly disabled: boolean;
  readonly schemaVersion: number;
  /** When the sender next posts, or null while reporting is off. */
  readonly nextReportAt: string | null;
}

export const INSTANCE_ID_NOT_MINTED = "(minted on the first report)";

export interface UsageReportPreviewDeps {
  readonly prisma: PrismaClient;
  readonly disabled: boolean;
  readonly endpoint: () => Promise<string>;
  readonly identity: () => Promise<{
    instanceId: string;
    createdAt: Date;
    optionalMetricsOptOut: boolean;
    hostnameOptOut: boolean;
  } | null>;
  readonly collect: (input: {
    organizationIds: string[];
    instanceId: string;
    firstSeenAt: Date | null;
    switches: UsageReportSwitchState;
  }) => Promise<Record<string, unknown>>;
  readonly now?: () => Date;
}

export async function usageReportPreview(
  deps: UsageReportPreviewDeps,
): Promise<UsageReportPreview> {
  const now = deps.now?.() ?? new Date();
  const [organizations, identity, endpoint] = await Promise.all([
    deps.prisma.organization.findMany({ select: { id: true } }),
    deps.identity(),
    deps.endpoint(),
  ]);
  const switches: UsageReportSwitchState = {
    optional: !identity?.optionalMetricsOptOut,
    hostname: !identity?.hostnameOptOut,
  };
  const payload =
    organizations.length === 0
      ? {}
      : await deps.collect({
          organizationIds: organizations.map((organization) => organization.id),
          instanceId: identity?.instanceId ?? INSTANCE_ID_NOT_MINTED,
          firstSeenAt: identity?.createdAt ?? null,
          switches,
        });

  return {
    payload: { event: "daily_usage_stats", ...payload },
    switches,
    endpoint,
    disabled: deps.disabled,
    schemaVersion: USAGE_REPORT_SCHEMA_VERSION,
    nextReportAt: deps.disabled ? null : nextNoonUtc(now).toISOString(),
  };
}

/** The sender's own schedule: 12:00 UTC, today if it is still ahead. */
export function nextNoonUtc(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(12, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}
