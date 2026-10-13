/** Spec: modules/trace/specs/trace-ingest-allowance.feature */
import { setLedgerCurrent } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TraceIngestAllowanceService } from "../trace-ingest-allowance.service.ts";

const run = async (failure: unknown) => {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const service = TraceIngestAllowanceService.create({
    entitlement: { assertWithinUsageLimit: () => Promise.reject(failure) },
    logger,
  });
  await service.assertWithinAllowance({ projectId: "p", organizationId: "o" });
  return logger;
};

const clickHouseUnknownTable = () =>
  Object.assign(new Error("Unknown table expression identifier 'usage_trace_meter'"), {
    type: "UNKNOWN_TABLE",
    code: "60",
  });

describe("trace limit check failure level", () => {
  afterEach(() => setLedgerCurrent({ current: false }));

  describe("given the upgrade has not finished", () => {
    /** @scenario "An allowance read that fails because the schema is behind is logged as a warning" */
    it("warns when a Postgres table is missing (P2021)", async () => {
      const logger = await run(Object.assign(new Error("no table"), { code: "P2021" }));
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
    });

    /** @scenario "An allowance read that fails because the schema is behind is logged as a warning" */
    it("warns when a ClickHouse table is missing (UNKNOWN_TABLE)", async () => {
      const logger = await run(clickHouseUnknownTable());
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("given the upgrade has finished", () => {
    /** @scenario "An allowance read that fails for any other reason is logged as an error" */
    it("errors when the schema and the ledger disagree", async () => {
      setLedgerCurrent({ current: true });
      const logger = await run(clickHouseUnknownTable());
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  /** @scenario "An allowance read that fails for any other reason is logged as an error" */
  it("errors on a connection reset", async () => {
    const logger = await run(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

class ClickHouseBusy extends HandledError {
  constructor() {
    super("clickhouse_overloaded", "The database is busy", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
    });
  }
}

describe("trace limit check on a busy ClickHouse", () => {
  /** @scenario "An allowance read a busy ClickHouse refuses is logged as a warning" */
  it("warns, because the refusal is transient and retried", async () => {
    const logger = await run(new ClickHouseBusy());
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
