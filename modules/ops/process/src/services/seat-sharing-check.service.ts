import type { AuthApi } from "@langwatch/auth-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  SEAT_SHARING_WINDOW_DAYS,
  type SeatSharingCheck,
  type SeatSharingReading,
} from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { TenantSource } from "@langwatch/system-migrations";
import type { UserApi } from "@langwatch/user-contract";

import type { SeatSharingCheckRepository } from "../repositories/seat-sharing-check.repository.ts";
import {
  hasCappedSeats,
  seatHoldersInWindow,
  seatSharingReading,
  seatSharingWindowStart,
} from "../rules/seat-sharing.rules.ts";

/** Organizations read per page of the walk, and how many of a page are read at once. */
const PAGE_SIZE = 200;
const CONCURRENCY = 8;

/** Each owner answers for its own rows: the plan, the seats, the sessions, the sign-ins. */
export interface SeatSharingPeers {
  readonly plans: Pick<EntitlementApi, "getActivePlan">;
  readonly organizations: Pick<OrganizationApi, "findSeatOccupantsSince">;
  readonly sessions: Pick<AuthApi, "findSessionUsersSince">;
  readonly users: Pick<UserApi, "findSignedInSince">;
}

interface SeatSharingCheckDeps {
  organizationIds: TenantSource;
  peers: SeatSharingPeers;
  checks: SeatSharingCheckRepository;
  now: () => number;
  logger: Pick<Logger, "warn">;
}

/**
 * The Ops seat sharing check: for every organization on a paid plan, the distinct people who
 * held a seat in the last 30 days and were active in them, beside its paid full seats.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
export class SeatSharingCheckService {
  static create(
    deps: Omit<SeatSharingCheckDeps, "logger"> & { logger?: Pick<Logger, "warn"> },
  ): SeatSharingCheckService {
    return new SeatSharingCheckService({
      ...deps,
      logger: deps.logger ?? createLogger("langwatch:ops:seat-sharing"),
    });
  }

  private constructor(private readonly deps: SeatSharingCheckDeps) {}

  /** The last check, empty before the first one. */
  findLast(): Promise<SeatSharingCheck[]> {
    return this.deps.checks.find();
  }

  /** Walks every organization, reads the ones on a paid plan, and keeps the result. */
  async run(): Promise<SeatSharingCheck> {
    const now = this.deps.now();
    const since = seatSharingWindowStart(now);
    const readings: SeatSharingReading[] = [];
    let page = await this.deps.organizationIds.findTenantIdsAfter({
      cursor: null,
      limit: PAGE_SIZE,
    });
    while (page.length > 0) {
      readings.push(...(await this.readPage({ organizationIds: page, since })));
      page = await this.deps.organizationIds.findTenantIdsAfter({
        cursor: page[page.length - 1] ?? null,
        limit: PAGE_SIZE,
      });
    }
    const check: SeatSharingCheck = {
      checkedAt: now,
      windowDays: SEAT_SHARING_WINDOW_DAYS,
      readings,
    };
    await this.deps.checks.save(check);
    return check;
  }

  private async readPage({
    organizationIds,
    since,
  }: {
    organizationIds: readonly string[];
    since: number;
  }): Promise<SeatSharingReading[]> {
    const readings: SeatSharingReading[] = [];
    for (let start = 0; start < organizationIds.length; start += CONCURRENCY) {
      const batch = organizationIds.slice(start, start + CONCURRENCY);
      const read = await Promise.all(
        batch.map((organizationId) => this.readOrSkip({ organizationId, since })),
      );
      readings.push(...read.flat());
    }
    return readings;
  }

  /** One organization that cannot be read is skipped and logged; the walk goes on. */
  private async readOrSkip(input: {
    organizationId: string;
    since: number;
  }): Promise<SeatSharingReading[]> {
    try {
      return await this.readOne(input);
    } catch (error) {
      this.deps.logger.warn(
        {
          organizationId: input.organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "seat sharing check skipped an organization it could not read",
      );
      return [];
    }
  }

  private async readOne({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<SeatSharingReading[]> {
    const { plans, organizations } = this.deps.peers;
    const plan = await plans.getActivePlan({ organizationId });
    if (plan.free || !hasCappedSeats(plan.maxMembers)) return [];
    const holders = seatHoldersInWindow(
      await organizations.findSeatOccupantsSince({ organizationId, since }),
    );
    return [
      seatSharingReading({
        organizationId,
        planName: plan.name,
        seats: Math.max(0, Math.floor(plan.maxMembers)),
        activePeople: (await this.activeAmong({ userIds: holders, since })).size,
      }),
    ];
  }

  /** Active means signed in, or used a browser session, at or after `since`. */
  private async activeAmong({
    userIds,
    since,
  }: {
    userIds: readonly string[];
    since: number;
  }): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const { sessions, users } = this.deps.peers;
    const [sessionUsers, signedIn] = await Promise.all([
      sessions.findSessionUsersSince({ userIds, since }),
      users.findSignedInSince({ userIds, since }),
    ]);
    return new Set([...sessionUsers, ...signedIn]);
  }
}
