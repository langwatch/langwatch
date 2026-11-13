import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";

/**
 * The organization's seat lease for a holder that writes a seat-holding row itself (a directory
 * admission): the same lease every seat write here holds, taken, renewed and dropped by call.
 */
export class OrganizationSeatLeaseService {
  static create(seats: OrganizationSeatRepository): OrganizationSeatLeaseService {
    return new OrganizationSeatLeaseService(seats);
  }

  private constructor(private readonly seats: OrganizationSeatRepository) {}

  /** Waits while another seat change holds the lease, then refuses seat_change_busy. */
  acquire(input: { organizationId: string }): Promise<{ holder: string; renewEveryMs: number }> {
    return this.seats.acquireSeatLease(input);
  }

  /** False when the lease is no longer this holder's. */
  renew(input: { organizationId: string; holder: string }): Promise<boolean> {
    return this.seats.renewSeatLease(input);
  }

  release(input: { organizationId: string; holder: string }): Promise<void> {
    return this.seats.releaseSeatLease(input);
  }
}
