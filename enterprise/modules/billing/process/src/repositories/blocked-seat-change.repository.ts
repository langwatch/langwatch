// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { BlockedSeatChangeAttempt } from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

/** One refused seat change still waiting for its admin to hear billing works again. */
export type BlockedSeatChange = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  attempt: BlockedSeatChangeAttempt;
  seats: number;
  createdAt: Instant;
}>;

/** The seat changes billing refused for two live subscriptions, kept until their admin is told. */
export abstract class BlockedSeatChangeRepository {
  abstract record(input: {
    organizationId: string;
    userId: string;
    attempt: BlockedSeatChangeAttempt;
    seats: number;
  }): Promise<void>;
  /** Every change whose admin has not been told yet, oldest first, across organizations. */
  abstract findWaiting(): Promise<BlockedSeatChange[]>;
  /** This admin's changes in this organization whose admin has not been told yet. */
  abstract findWaitingFor(input: {
    organizationId: string;
    userId: string;
  }): Promise<BlockedSeatChange[]>;
  /** Marks this admin's waiting changes in this organization told, up to the one the notice read. */
  abstract markNotified(input: {
    organizationId: string;
    userId: string;
    createdUpTo: Instant;
    at: Instant;
  }): Promise<void>;
}
