/**
 * @vitest-environment node
 * Cloud admin answers only on LangWatch's SaaS (ARCHITECTURE.md §3.5): off it,
 * subscriptions refuse as not found while instance admin keeps answering.
 */
import type { OpsOperator } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

const STAFF: OpsOperator = { id: "operator", email: OPS_STAFF_ADDRESS };

function appOn({ isSaas }: { isSaas: boolean }) {
  const adminOperation = vi.fn(async () => ({ data: [], total: 0 }));
  const { app } = createOpsTestApp({ members: { isSaas }, capability: { adminOperation } });
  const run = (resource: string) =>
    app.runAdminOperation({
      actor: STAFF,
      req: { headers: {} },
      resource,
      method: "getList",
      params: {},
    });
  return { run, adminOperation };
}

describe("given an operator on an install that is not LangWatch's SaaS", () => {
  it("refuses subscriptions as not found without reaching the store", async () => {
    const { run, adminOperation } = appOn({ isSaas: false });

    await expect(async () => run("subscriptions")).rejects.toMatchObject({ code: "not_found" });
    expect(adminOperation).not.toHaveBeenCalled();
  });

  it("still answers instance admin resources", async () => {
    const { run, adminOperation } = appOn({ isSaas: false });

    await run("user");
    expect(adminOperation).toHaveBeenCalledOnce();
  });
});

describe("given an operator on LangWatch's SaaS", () => {
  it("answers subscriptions", async () => {
    const { run, adminOperation } = appOn({ isSaas: true });

    await run("subscriptions");
    expect(adminOperation).toHaveBeenCalledOnce();
  });
});
