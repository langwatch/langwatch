/**
 * `CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE` reaches the stores owner as the share each kind of
 * ClickHouse statement keeps from the other; a typo is reported and falls back to the default.
 * @see specs/clickhouse/single-client-access.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storesOwner } from "../config-owner.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [storesOwner], environment }).stores
    .clickhouseStatementLaneReserveShare;

describe("the statement lane reserve share", () => {
  let reported: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reported = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    reported.mockRestore();
  });

  describe("given the variable is unset", () => {
    it("leaves it to the limiter's default without a warning", () => {
      expect(read({})).toBeUndefined();
      expect(reported).not.toHaveBeenCalled();
    });
  });

  describe.each(["0.3", "0.5"])("given the variable holds %s", (raw) => {
    it("reads that share", () => {
      expect(read({ CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE: raw })).toBe(Number(raw));
      expect(reported).not.toHaveBeenCalled();
    });
  });

  describe.each(["0", "0.6", "abc"])("given the variable is %j", (raw) => {
    it("falls back to the default and reports the bad value", () => {
      expect(read({ CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE: raw })).toBeUndefined();
      expect(String(reported.mock.calls[0]?.[0])).toContain(
        `CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE "${raw}"`,
      );
    });
  });

  describe.each([
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("given the variable is %s", (_label, raw) => {
    it("takes the default without a warning", () => {
      expect(read({ CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE: raw })).toBeUndefined();
      expect(reported).not.toHaveBeenCalled();
    });
  });
});
