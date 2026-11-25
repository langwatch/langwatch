// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connected customer's contract terms and seats (ADR-156). The hosted wire is the connect
 * module's contract.
 */

import type { ConnectService } from "./issued-license.ts";

/**
 * What a customer's licenses add up to commercially. The budget spans
 * licenses, so the terms do too.
 */
export interface ContractTerms {
  /** Prepaid usage across the customer's licenses. The default cap. */
  commitUsdCents: number;
  /** The highest cap the customer may set: the commit plus agreed overage. */
  maximumUsdCents: number;
  overageEnabled: boolean;
  /** Hosted services any of the counted licenses is entitled to. */
  services: ConnectService[];
  /** ISO instant the last of the counted terms ends, or null when none counts. */
  termEndsAt: string | null;
  /** ISO instant the first of the counted terms began, or null. */
  termStartsAt: string | null;
}

/** The seats a connected customer holds, read off its longest-running active license. */
export interface ConnectedSeats {
  licensed: number;
  /** Members the install last reported; null until it has synced. */
  reported: number | null;
  /** ISO instant of the latest sync of any active license, or null. */
  lastSyncAt: string | null;
  /** The managed gateway key the customer's hosted calls run under, once one resolved. */
  managedVirtualKeyId: string | null;
}
