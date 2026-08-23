/**
 * The run-time translation of a member's unknown column into the handled
 * `lwql_unknown_identifier` — the one authoring mistake save-time validation
 * deliberately does not catch, so run time is the only place to name it.
 *
 * Driven through `translateLangWatchQLExecutionError`, the exact function the
 * executor's catch throws through, with errors shaped the way the ClickHouse
 * driver actually delivers them (a `code`/`type` property, or a raw
 * `Code: <n>.` HTTP body). The load-bearing assertions:
 *
 *  - the numeric code, not the message, selects the failure class;
 *  - the identifier the member wrote is recovered from the message and is the
 *    ONLY piece of the raw database text that reaches the handled error;
 *  - anything unmapped passes through untouched and degrades to "unknown"
 *    (ADR-045).
 *
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  LangWatchQLUnknownIdentifierError,
  unknownIdentifierFromClickHouseMessage,
} from "../errors";
import { translateLangWatchQLExecutionError } from "../executor";

/** An error the way `@clickhouse/client` raises a server refusal. */
function driverError({
  code,
  type,
  message,
}: {
  code?: string;
  type?: string;
  message: string;
}): Error {
  const error = new Error(message);
  if (code !== undefined) (error as { code?: string }).code = code;
  if (type !== undefined) (error as { type?: string }).type = type;
  return error;
}

const ANALYZER_MESSAGE =
  "Unknown expression identifier `NoSuchColumn` in scope SELECT NoSuchColumn FROM trace_metrics_by_minute. (UNKNOWN_IDENTIFIER)";
const LEGACY_MESSAGE =
  "Missing columns: 'NoSuchColumn' while processing query: 'SELECT NoSuchColumn FROM trace_metrics_by_minute', required columns: 'NoSuchColumn'. (UNKNOWN_IDENTIFIER)";

describe("translateLangWatchQLExecutionError", () => {
  describe("when ClickHouse refuses with UNKNOWN_IDENTIFIER (47)", () => {
    /** @scenario "An unknown column is refused by name at run time" */
    it("returns the handled lwql_unknown_identifier naming the identifier", () => {
      const translated = translateLangWatchQLExecutionError(
        driverError({
          code: "47",
          type: "UNKNOWN_IDENTIFIER",
          message: ANALYZER_MESSAGE,
        }),
        12,
      );

      expect(translated).toBeInstanceOf(LangWatchQLUnknownIdentifierError);
      const handled = translated as LangWatchQLUnknownIdentifierError;
      expect(handled.code).toBe("lwql_unknown_identifier");
      expect(handled.httpStatus).toBe(400);
      expect(handled.fault).toBe("customer");
      expect(handled.meta).toMatchObject({ identifier: "NoSuchColumn" });
    });

    /** @scenario "An unknown column is refused by name at run time" */
    it("relays only the identifier, never the raw database text", () => {
      const translated = translateLangWatchQLExecutionError(
        driverError({ code: "47", message: ANALYZER_MESSAGE }),
        12,
      ) as LangWatchQLUnknownIdentifierError;

      // The raw text echoes the submitted query and the server's own scope
      // dump; none of it may ride on the handled message or meta.
      expect(translated.message).not.toContain("trace_metrics_by_minute");
      expect(translated.message).not.toContain("scope");
      expect(JSON.stringify(translated.meta)).not.toContain("SELECT");
    });

    it("recovers the identifier from the legacy analyzer's message shape", () => {
      const translated = translateLangWatchQLExecutionError(
        driverError({ code: "47", message: LEGACY_MESSAGE }),
        12,
      ) as LangWatchQLUnknownIdentifierError;

      expect(translated.meta).toMatchObject({ identifier: "NoSuchColumn" });
    });

    it("matches by the Code prefix of a raw HTTP body, driver properties absent", () => {
      const translated = translateLangWatchQLExecutionError(
        new Error(`Code: 47. DB::Exception: ${ANALYZER_MESSAGE}`),
        12,
      );

      expect(translated).toBeInstanceOf(LangWatchQLUnknownIdentifierError);
    });

    /** @scenario "An unknown-identifier refusal whose message shape is unrecognised still gets the handled code" */
    it("still hands back the code when the message shape is unrecognised", () => {
      const translated = translateLangWatchQLExecutionError(
        driverError({
          code: "47",
          message: "something entirely new the server started saying",
        }),
        12,
      ) as LangWatchQLUnknownIdentifierError;

      expect(translated).toBeInstanceOf(LangWatchQLUnknownIdentifierError);
      expect(translated.meta.identifier).toBeUndefined();
      expect(translated.message).not.toContain("entirely new");
    });
  });

  describe("when ClickHouse refuses with NO_SUCH_COLUMN_IN_TABLE (16)", () => {
    it("translates it to the same handled code", () => {
      const translated = translateLangWatchQLExecutionError(
        driverError({
          code: "16",
          type: "NO_SUCH_COLUMN_IN_TABLE",
          message:
            "There is no column with name `NoSuchColumn` in table trace_metrics_by_minute. (NO_SUCH_COLUMN_IN_TABLE)",
        }),
        12,
      ) as LangWatchQLUnknownIdentifierError;

      expect(translated).toBeInstanceOf(LangWatchQLUnknownIdentifierError);
      expect(translated.meta).toMatchObject({ identifier: "NoSuchColumn" });
    });
  });

  describe("when the failure is anything the platform has not named", () => {
    /** @scenario "An unrelated database failure still degrades to unknown" */
    it("passes the error through untouched so it degrades to unknown", () => {
      const raw = driverError({
        code: "999",
        message:
          "Code: 999. DB::Exception: something the platform has no name for",
      });

      expect(translateLangWatchQLExecutionError(raw, 12)).toBe(raw);
    });

    it("never selects the code from message text alone", () => {
      // A member could alias a column `UNKNOWN_IDENTIFIER`; the message
      // echoing it must not pick the failure class.
      const raw = driverError({
        code: "999",
        message:
          "refers to UNKNOWN_IDENTIFIER and Unknown expression identifier `x`",
      });

      expect(translateLangWatchQLExecutionError(raw, 12)).toBe(raw);
    });
  });
});

describe("unknownIdentifierFromClickHouseMessage", () => {
  it("caps a pathological identifier rather than relaying it", () => {
    const enormous = "a".repeat(4_000);
    expect(
      unknownIdentifierFromClickHouseMessage(
        `Unknown expression identifier \`${enormous}\` in scope SELECT 1`,
      ),
    ).toBeUndefined();
  });

  it("yields nothing for a message carrying no recognised shape", () => {
    expect(
      unknownIdentifierFromClickHouseMessage("DB::Exception: boom"),
    ).toBeUndefined();
  });
});
