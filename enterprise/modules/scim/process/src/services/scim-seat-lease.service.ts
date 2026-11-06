// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { ScimSeatRepository } from "../repositories/scim-seat.repository.ts";

const logger = createLogger("langwatch:scim:seat-lease");

/** The organization operations a directory admission holds its seat lease through. */
export type ScimSeatLeaseApi = Pick<
  OrganizationApi,
  "acquireSeatLease" | "renewSeatLease" | "releaseSeatLease"
>;

/** Runs `work` holding organization's seat lease, the one its own seat writes hold. */
export interface ScimSeatLock {
  withSeatLock<T>(input: Readonly<{ organizationId: string; work: () => Promise<T> }>): Promise<T>;
}

/** What an admission is held to: the seat counts, read and written under the seat lease. */
export type ScimSeats = Pick<ScimSeatRepository, "countMemberSeats"> & ScimSeatLock;

/**
 * Organization's seat lease, taken through its Api: acquired (or refused seat_change_busy after
 * the wait), renewed at the interval organization names while `work` runs, released after.
 */
export class ScimSeatLeaseService implements ScimSeatLock {
  static create(lease: ScimSeatLeaseApi): ScimSeatLeaseService {
    return new ScimSeatLeaseService(lease);
  }

  private constructor(private readonly lease: ScimSeatLeaseApi) {}

  async withSeatLock<T>({
    organizationId,
    work,
  }: Readonly<{ organizationId: string; work: () => Promise<T> }>): Promise<T> {
    const { holder, renewEveryMs } = await this.lease.acquireSeatLease({ organizationId });
    const renewal = setInterval(() => {
      this.lease.renewSeatLease({ organizationId, holder }).catch((error: unknown) => {
        logger.warn(
          { error, organizationId, holder },
          "seat lease renewal failed; the lease may expire mid-admission",
        );
      });
    }, renewEveryMs);
    try {
      return await work();
    } finally {
      clearInterval(renewal);
      await this.lease.releaseSeatLease({ organizationId, holder });
    }
  }
}
