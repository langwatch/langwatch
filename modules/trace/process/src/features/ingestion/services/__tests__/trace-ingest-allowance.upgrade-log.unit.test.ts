import { describe, expect, it, vi } from "vitest";

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

describe("trace limit check failure level", () => {
  it("warns when the schema is behind (P2021)", async () => {
    const logger = await run(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("errors on any other failure", async () => {
    const logger = await run(new Error("boom"));
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
