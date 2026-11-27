// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import { type OrganizationApi, SeatChangeBusyError } from "@langwatch/organization-contract";

import type { ScimSeatRepository } from "../repositories/scim-seat.repository.ts";

const logger = createLogger("langwatch:scim:seat-lease");

/** The organization operations a directory admission holds its seat lease through. */
export type ScimSeatLeaseApi = Pick<
  OrganizationApi,
  "acquireSeatLease" | "renewSeatLease" | "releaseSeatLease"
>;

/** What the work holds: `assertHeld` right before the membership write fences it. */
export interface ScimHeldLease {
  assertHeld(): Promise<void>;
}

/** Runs `work` holding organization's seat lease, the one its own seat writes hold. */
export interface ScimSeatLock {
  withSeatLock<T>(
    input: Readonly<{ organizationId: string; work: (lease: ScimHeldLease) => Promise<T> }>,
  ): Promise<T>;
}

/** What an admission is held to: the seat counts, read and written under the seat lease. */
export type ScimSeats = Pick<ScimSeatRepository, "countMemberSeats" | "findLiveHoldUserIds"> &
  ScimSeatLock;

/**
 * Organization's seat lease, taken through its Api: acquired (or refused seat_change_busy after
 * the wait), renewed at the interval organization names while `work` runs, released after. A
 * write fenced by `assertHeld` after the lease went to another change is refused seat_change_busy.
 */
export class ScimSeatLeaseService implements ScimSeatLock {
  static create(lease: ScimSeatLeaseApi): ScimSeatLeaseService {
    return new ScimSeatLeaseService(lease);
  }

  private constructor(private readonly lease: ScimSeatLeaseApi) {}

  async withSeatLock<T>({
    organizationId,
    work,
  }: Readonly<{ organizationId: string; work: (lease: ScimHeldLease) => Promise<T> }>): Promise<T> {
    const { holder, renewEveryMs } = await this.lease.acquireSeatLease({ organizationId });
    const renew = () => this.lease.renewSeatLease({ organizationId, holder });
    let lost = false;
    const renewal = setInterval(() => {
      renew()
        .then((held) => {
          if (!held) lost = true;
        })
        .catch((error: unknown) => {
          logger.warn(
            { error, organizationId, holder },
            "seat lease renewal failed; the lease may expire mid-admission",
          );
        });
    }, renewEveryMs);
    const held: ScimHeldLease = {
      assertHeld: async () => {
        if (lost || !(await renew())) {
          lost = true;
          throw new SeatChangeBusyError();
        }
      },
    };
    try {
      return await work(held);
    } finally {
      clearInterval(renewal);
      await this.lease.releaseSeatLease({ organizationId, holder });
    }
  }
}
