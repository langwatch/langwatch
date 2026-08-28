import { describe, expect, it, vi } from "vitest";

type GuardParams = {
  action: string;
  args: unknown;
  model?: string;
};

type GuardNext = (params: GuardParams) => Promise<unknown>;

const calls = vi.hoisted(() => ({
  order: [] as string[],
}));

vi.mock("~/server/dbSlowQueryWarning", () => ({
  withQueryTiming: <T>({ run }: { run: () => Promise<T> }): Promise<T> => {
    calls.order.push("timing");
    return run();
  },
}));

vi.mock("~/utils/dbMassDeleteProtection", () => ({
  guardEnMasse: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("mass-delete");
    return next({ ...params, args: { stage: "mass-delete" } });
  },
}));

vi.mock("~/utils/dbMultiTenancyProtection", () => ({
  guardProjectId: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("project");
    return next({ ...params, args: { stage: "project" } });
  },
}));

vi.mock("~/utils/dbOrganizationIdProtection", () => ({
  guardOrganizationId: (params: GuardParams, next: GuardNext): Promise<unknown> => {
    calls.order.push("organization");
    return next({ ...params, args: { stage: "organization" } });
  },
}));

import { AppPrismaQueryGuard } from "../prisma-process.composition";

describe("AppPrismaQueryGuard", () => {
  it("times and applies the legacy guards in registration order before delegation", async () => {
    calls.order.length = 0;
    const next = vi.fn(async (args: unknown) => {
      calls.order.push("delegate");
      return args;
    });

    const result = await new AppPrismaQueryGuard().execute(
      {
        model: "Project",
        action: "deleteMany",
        args: { where: { id: "FORCE_DELETE_ALL" } },
      },
      next,
    );

    expect(calls.order).toEqual(["timing", "mass-delete", "project", "organization", "delegate"]);
    expect(next).toHaveBeenCalledWith({ stage: "organization" });
    expect(result).toEqual({ stage: "organization" });
  });
});
