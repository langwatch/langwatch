import { describe, expect, it, vi } from "vitest";
import type { GuardNext, GuardParams } from "./guard-middleware";

const calls = vi.hoisted(() => ({
  order: [] as string[],
  massDeleteParams: [] as GuardParams[],
}));

vi.mock("./mass-delete-guard", () => ({
  guardEnMasse: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("mass-delete");
    calls.massDeleteParams.push(params);
    return next({ ...params, args: { stage: "mass-delete" } });
  },
}));

vi.mock("./multi-tenancy-guard", () => ({
  guardProjectId: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("project");
    return next({ ...params, args: { stage: "project" } });
  },
}));

vi.mock("./organization-guard", () => ({
  guardOrganizationId: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("organization");
    return next({ ...params, args: { stage: "organization" } });
  },
}));

import { PrismaTenancyGuardService } from "./tenancy-guard";

function reset(): void {
  calls.order.length = 0;
  calls.massDeleteParams.length = 0;
}

describe("PrismaTenancyGuardService", () => {
  describe("given a model operation", () => {
    it("applies the guards in registration order before delegating", async () => {
      reset();
      const next = vi.fn(async (args: unknown) => {
        calls.order.push("delegate");
        return args;
      });

      const result = await PrismaTenancyGuardService.create().execute(
        { model: "Project", action: "deleteMany", args: { where: { id: "FORCE_DELETE_ALL" } } },
        next,
      );

      expect(calls.order).toEqual(["mass-delete", "project", "organization", "delegate"]);
      expect(next).toHaveBeenCalledWith({ stage: "organization" });
      expect(result).toEqual({ stage: "organization" });
    });

    it("hands the guards the model, the action and the untouched arguments", async () => {
      reset();
      const args = { where: { projectId: "project-1" } };

      await PrismaTenancyGuardService.create().execute(
        { model: "Trace", action: "findMany", args },
        async (guarded) => guarded,
      );

      expect(calls.massDeleteParams).toEqual([{ model: "Trace", action: "findMany", args }]);
      expect(calls.massDeleteParams[0]?.args).toBe(args);
    });
  });

  describe("given a model-less raw operation", () => {
    it("carries no model key at all, which is what the guards branch on", async () => {
      reset();

      await PrismaTenancyGuardService.create().execute(
        { action: "queryRaw", args: { query: "SELECT 1" } },
        async (guarded) => guarded,
      );

      expect(calls.massDeleteParams).toHaveLength(1);
      expect(Object.hasOwn(calls.massDeleteParams[0]!, "model")).toBe(false);
    });
  });
});
