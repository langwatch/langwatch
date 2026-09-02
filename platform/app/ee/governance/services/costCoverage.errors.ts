// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the key-to-bill mapping refuses, said in words an administrator can act
 * on (ADR-128 §7).
 *
 * All three are ordinary things for a person editing a small list to do — claim
 * a key somebody else just claimed, pick today when today is already the start,
 * hand an API a timestamp where the screen offers a date. None is an incident,
 * so all three are `fault: "customer"`, and none of them may reach the
 * administrator as a trace id.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import { HandledError } from "@langwatch/handled-error";

/**
 * Another bill already covers this key over the period being claimed.
 *
 * Raised from SQLSTATE 23P01, which is where the rule actually lives — the
 * exclusion constraint on `IngestionSourceKeyCoverage`. There is deliberately
 * no read-then-write check in front of it that could report this sooner: two
 * administrators saving in the same instant both pass such a read, and only the
 * database sees the collision.
 */
export class GatewayKeyAlreadyCoveredError extends HandledError {
  declare readonly code: "ingestion_source_key_already_covered";

  constructor(virtualKeyId: string) {
    super(
      "ingestion_source_key_already_covered",
      "Another bill already covers this gateway key",
      {
        httpStatus: 409,
        fault: "customer",
        meta: { virtualKeyId },
      },
    );
    this.name = "GatewayKeyAlreadyCoveredError";
  }
}

/**
 * Coverage was asked to start partway through a day.
 *
 * The rollup buckets spend by UTC day, so a day is the finest thing a bill can
 * own; a mid-day start would file the whole day under whichever bill the read
 * happened to resolve. The screen offers a date rather than a timestamp, so
 * this is reachable only through the API.
 */
export class CoverageStartNotMidnightError extends HandledError {
  declare readonly code: "ingestion_source_coverage_not_midnight";

  constructor(startedAt: Date) {
    super(
      "ingestion_source_coverage_not_midnight",
      "Coverage can only start at the beginning of a UTC day",
      {
        httpStatus: 400,
        fault: "customer",
        meta: { startedAt: startedAt.toISOString() },
      },
    );
    this.name = "CoverageStartNotMidnightError";
  }
}

/**
 * A re-point was asked to take effect no later than the coverage it replaces
 * began.
 *
 * Closing the current row at that instant would leave a range covering no time
 * at all, which an exclusion constraint cannot see — so this is refused before
 * the write, and by the `CHECK` behind it if a race gets past.
 */
export class CoverageStartNotAfterCurrentError extends HandledError {
  declare readonly code: "ingestion_source_coverage_not_after_start";

  constructor(params: { virtualKeyId: string; currentStartedAt: Date }) {
    super(
      "ingestion_source_coverage_not_after_start",
      "Coverage must move to a day after the day the current coverage started",
      {
        httpStatus: 409,
        fault: "customer",
        meta: {
          virtualKeyId: params.virtualKeyId,
          currentStartedAt: params.currentStartedAt.toISOString(),
        },
      },
    );
    this.name = "CoverageStartNotAfterCurrentError";
  }
}
