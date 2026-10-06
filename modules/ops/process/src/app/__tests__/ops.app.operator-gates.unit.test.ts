/**
 * @vitest-environment node
 * Every operator gate asks authz for the platform-operator grant: ops:view for reads,
 * ops:manage for writes, the impersonator's own grant when impersonating.
 * Spec: modules/ops/specs/admin.feature
 */
import type { AdminOperationInput, OpsOperator } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { createOpsTestApp, platformOperatorAuthz } from "./ops.fixture.ts";

const VIEWER: OpsOperator = { id: "user_viewer", email: "viewer@langwatch.ai" };
const MANAGER: OpsOperator = { id: "user_manager", email: "manager@langwatch.ai" };
const OUTSIDER: OpsOperator = { id: "user_outsider", email: "outsider@acme.com" };
const IMPERSONATING_MANAGER: OpsOperator = {
  id: "user_customer",
  email: "customer@acme.com",
  impersonator: { id: MANAGER.id, email: MANAGER.email },
};

const { app } = createOpsTestApp({
  authz: platformOperatorAuthz({
    holders: {
      [VIEWER.id]: ["ops:view"],
      [MANAGER.id]: ["ops:view", "ops:manage"],
    },
  }),
});

describe("given the platform-operator grant answers through authz", () => {
  /** @scenario "Operator gates ask the platform-operator grant" */
  it("admits a read for a holder of ops:view and refuses a non-holder", async () => {
    await expect(app.admitOperator(VIEWER, "ops:view")).resolves.toBeUndefined();
    await expect(app.admitOperator(OUTSIDER, "ops:view")).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(app.admitOperator(null, "ops:view")).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  /** @scenario "Operator gates ask the platform-operator grant" */
  it("admits a write only for a holder of ops:manage", async () => {
    await expect(app.admitOperator(MANAGER, "ops:manage")).resolves.toBeUndefined();
    await expect(app.admitOperator(VIEWER, "ops:manage")).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  /** @scenario "Operator gates ask the platform-operator grant" */
  it("reads an impersonating operator by the impersonator's own grant", async () => {
    await expect(app.admitOperator(IMPERSONATING_MANAGER, "ops:manage")).resolves.toBeUndefined();
    expect(await app.operatorScope(IMPERSONATING_MANAGER)).toEqual({ kind: "platform" });
  });

  /** @scenario "Operator gates ask the platform-operator grant" */
  /** @scenario "resolveOpsScope returns kind=platform for admin users" */
  /** @scenario "resolveOpsScope returns kind=none for non-ops users instead of null" */
  it("answers the operator scope as an answer, never a refusal", async () => {
    expect(await app.operatorScope(VIEWER)).toEqual({ kind: "platform" });
    expect(await app.operatorScope(OUTSIDER)).toEqual({ kind: "none" });
    expect(await app.operatorScope(null)).toEqual({ kind: "none" });
  });

  /** @scenario "Operator gates ask the platform-operator grant" */
  it("demands manage for an instance-admin write, hidden as not found", async () => {
    const run = (actor: OpsOperator, method: "getList" | "update") =>
      app.runAdminOperation({
        actor,
        req: { headers: {} },
        resource: "user",
        method,
        params: {},
      });

    await expect(run(VIEWER, "update")).rejects.toMatchObject({ code: "not_found" });
    await expect(run(OUTSIDER, "update")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("given an impersonating operator in the Back office", () => {
  const backOfficeCalls: AdminOperationInput[] = [];
  const { app: backOffice } = createOpsTestApp({
    authz: platformOperatorAuthz({ holders: { [MANAGER.id]: ["ops:view", "ops:manage"] } }),
    capability: {
      adminOperation: async (input) => {
        backOfficeCalls.push(input);
        return { data: { id: input.params.id } };
      },
    },
  });
  const run = (method: "create" | "update", data: Record<string, unknown>) =>
    backOffice.runAdminOperation({
      actor: IMPERSONATING_MANAGER,
      req: { headers: {} },
      resource: "user",
      method,
      params: { id: "user_target", data },
    });

  /** @scenario "An impersonating operator cannot deactivate or reactivate an account from the back office" */
  it.each<["create" | "update", unknown]>([
    ["update", null],
    ["update", "2026-01-02T03:04:05.000Z"],
    ["update", ""],
    ["update", 5],
    ["create", null],
    ["create", "2026-01-02T03:04:05.000Z"],
  ])(
    "refuses %s with a deactivation of %s and never reaches the back office or user",
    async (method, deactivatedAt) => {
      backOfficeCalls.length = 0;
      await expect(run(method, { deactivatedAt })).rejects.toMatchObject({
        code: "ops_impersonated_operator_refused",
      });
      expect(backOfficeCalls).toEqual([]);
    },
  );

  /** @scenario "An impersonating operator cannot deactivate or reactivate an account from the back office" */
  /** @scenario "An impersonating admin stays the acting person" */
  it("still lets the impersonating operator update a user's other fields", async () => {
    backOfficeCalls.length = 0;
    await expect(run("update", { name: "Renamed" })).resolves.toEqual({
      data: { id: "user_target" },
    });
    expect(backOfficeCalls.map((call) => [call.method, call.params.data, call.actorId])).toEqual([
      ["update", { name: "Renamed" }, MANAGER.id],
    ]);
  });
});
