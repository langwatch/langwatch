// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Temporal } from "@langwatch/time";

/**
 * Customer.io's timestamp conditions in segments and campaign branches only match
 * Unix seconds, so every date attribute sent there goes out as whole seconds.
 */
export function unixSecondsOf(epochMilliseconds: number): number {
  return Math.floor(epochMilliseconds / 1000);
}

/** An ISO-8601 instant, as an owner recorded it, in Customer.io's Unix seconds. */
export function unixSecondsOfIso(iso: string): number {
  return unixSecondsOf(Temporal.Instant.from(iso).epochMilliseconds);
}
