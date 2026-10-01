/**
 * @vitest-environment node
 * Cloud admin answers only where ops's cloud-ops capability is on (ARCHITECTURE.md §3.5):
 * off it, subscriptions and the staff admission refuse as not found while instance admin answers.
 */
import type { OpsOperator } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

const STAFF: OpsOperator = { id: "operator", email: OPS_STAFF_ADDRESS };
const CUSTOMER: OpsOperator = { id: "customer", email: "someone@acme.com" };

function appOn({ cloudOps }: { cloudOps: boolean }) {
  const adminOperation = vi.fn(async () => ({ data: [], total: 0 }));
  const { app } = createOpsTestApp({ members: { cloudOps }, capability: { adminOperation } });
  const run = (resource: string) =>
    app.runAdminOperation({
      actor: STAFF,
      req: { headers: {} },
      resource,
      method: "getList",
      params: {},
    });
  return { app, run, adminOperation };
}

describe("given the cloud-ops capability is off", () => {
  /** @scenario "Cloud admin refuses as not found where the cloud-ops capability is off" */
  it("refuses subscriptions as not found without reaching the store", async () => {
    const { run, adminOperation } = appOn({ cloudOps: false });

    await expect(async () => run("subscriptions")).rejects.toMatchObject({ code: "not_found" });
    expect(adminOperation).not.toHaveBeenCalled();
  });

  it("still answers instance admin resources", async () => {
    const { run, adminOperation } = appOn({ cloudOps: false });

    await run("user");
    expect(adminOperation).toHaveBeenCalledOnce();
  });

  /** @scenario "Cloud admin refuses as not found where the cloud-ops capability is off" */
  it("refuses staff admission as not found and reports the capability off", () => {
    const { app } = appOn({ cloudOps: false });

    expect(() => app.admitCloudAdmin(STAFF)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(app.offersCloudOps()).toBe(false);
  });
});

describe("given the cloud-ops capability is on", () => {
  it("answers subscriptions", async () => {
    const { run, adminOperation } = appOn({ cloudOps: true });

    await run("subscriptions");
    expect(adminOperation).toHaveBeenCalledOnce();
  });

  it("admits staff and reports the capability on", () => {
    const { app } = appOn({ cloudOps: true });

    expect(app.admitCloudAdmin(STAFF).id).toBe("operator");
    expect(app.offersCloudOps()).toBe(true);
  });

  it("still refuses a caller who is not staff as not found", () => {
    const { app } = appOn({ cloudOps: true });

    expect(() => app.admitCloudAdmin(CUSTOMER)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});
