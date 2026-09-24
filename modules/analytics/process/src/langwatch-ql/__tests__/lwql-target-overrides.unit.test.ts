/** The stores' ClickHouse target stands unless an LWQL_* override disagrees with it (ADR-159). */
import { describe, expect, it } from "vitest";

import { applyLwqlTargetOverrides } from "../connection.ts";

const target = { url: "http://clickhouse:8123/", database: "langwatch" };

describe("given the stores' credential-free ClickHouse target", () => {
  describe("when no override is set, or one agrees", () => {
    it("keeps the target", () => {
      expect(
        applyLwqlTargetOverrides({ target, explicitUrl: undefined, explicitDatabase: undefined }),
      ).toEqual({ available: true, ...target });
      expect(
        applyLwqlTargetOverrides({
          target,
          explicitUrl: "http://clickhouse:8123",
          explicitDatabase: "langwatch",
        }),
      ).toEqual({ available: true, ...target });
    });
  });

  describe("when LWQL_CLICKHOUSE_URL names another server", () => {
    it("answers unavailable rather than honouring it", () => {
      expect(
        applyLwqlTargetOverrides({
          target,
          explicitUrl: "http://elsewhere:8123",
          explicitDatabase: undefined,
        }),
      ).toEqual({ available: false });
    });
  });

  describe("when LWQL_DATABASE names another database", () => {
    it("answers unavailable rather than honouring it", () => {
      expect(
        applyLwqlTargetOverrides({ target, explicitUrl: undefined, explicitDatabase: "other" }),
      ).toEqual({ available: false });
    });
  });
});
