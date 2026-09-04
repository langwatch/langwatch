// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the key-to-bill mapping refuses, said in words an administrator can act
 * on (ADR-128 §7).
 *
 * All of them are ordinary things for a person editing a small list to do —
 * claim a key somebody else just claimed, pick today when today is already the
 * start, hand an API a timestamp where the screen offers a date, name a key
 * that has since been deleted. None is an incident, so all are
 * `fault: "customer"`, and none of them may reach the administrator as a trace
 * id.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import { HandledError } from "@langwatch/handled-error";

/**
 * Another bill already covers this key.
 *
 * Raised from the one-open-bill unique index on `IngestionSourceKeyCoverage`
 * (SQLSTATE 23505, wrapped by Prisma as `P2002`), which is where the rule
 * actually lives. There is deliberately no read-then-write check in front of
 * it that could report this sooner: two administrators saving in the same
 * instant both pass such a read, and only the database sees the collision.
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
 * at all — refused before the write, and by the `CHECK` behind it if a race
 * gets past.
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

/**
 * Coverage named a gateway key this organization cannot map.
 *
 * Raised from the row-to-key organization trigger on
 * `IngestionSourceKeyCoverage`, which refuses a key that does not exist and a
 * key belonging to another organization with the same SQLSTATE. The two are
 * reported identically on purpose: distinguishing them would confirm to one
 * organization that another's key exists.
 *
 * 404 rather than 409, because from where the administrator stands there is no
 * such key to map.
 */
export class GatewayKeyNotMappableError extends HandledError {
  declare readonly code: "ingestion_source_coverage_key_not_found";

  constructor(virtualKeyId: string) {
    super(
      "ingestion_source_coverage_key_not_found",
      "That gateway key does not exist",
      {
        httpStatus: 404,
        fault: "customer",
        meta: { virtualKeyId },
      },
    );
    this.name = "GatewayKeyNotMappableError";
  }
}

/**
 * A day was asked for that is not a date.
 *
 * The read side resolves coverage as of a `YYYY-MM-DD` day. An unparseable one
 * has to be refused rather than carried: `new Date("…")` yields an Invalid Date
 * whose every comparison is false, which would silently read as *every* period
 * covering the day and report a mapping nobody recorded.
 */
export class CoverageDayNotADateError extends HandledError {
  declare readonly code: "ingestion_source_coverage_day_invalid";

  constructor(day: string) {
    super(
      "ingestion_source_coverage_day_invalid",
      "Coverage is read as of a calendar day",
      {
        httpStatus: 400,
        fault: "customer",
        meta: { day },
      },
    );
    this.name = "CoverageDayNotADateError";
  }
}
