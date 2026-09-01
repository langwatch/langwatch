import { describe, expect, it, vi } from "vitest";
import type { PrismaQueryContext, PrismaQueryExecutor } from "@langwatch/prisma-client";

const calls = vi.hoisted(() => ({
  order: [] as string[],
  contexts: [] as PrismaQueryContext[],
}));

vi.mock("~/server/dbSlowQueryWarning", () => ({
  withQueryTiming: <T>({ run }: { run: () => Promise<T> }): Promise<T> => {
    calls.order.push("timing");
    return run();
  },
}));

// The tenancy policy itself is packaged, and its own suite pins the order the
// three guards run in. What is left for this process to get right is the one
// thing it adds: the timing has to be OUTSIDE the guards, or a query the
// tenancy guard refuses would be reported as a fast success.
vi.mock("@langwatch/prisma-client", () => {
  class PrismaQueryGuard {}

  return {
    PrismaQueryGuard,
    PrismaTenancyGuardService: {
      create: () => ({
        execute: (context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> => {
          calls.order.push("tenancy");
          calls.contexts.push(context);
          return next({ stage: "tenancy" });
        },
      }),
    },
  };
});

import { AppPrismaQueryGuard } from "../prisma-process.composition";

describe("AppPrismaQueryGuard", () => {
  it("times the packaged tenancy guard from outside it, then delegates", async () => {
    calls.order.length = 0;
    calls.contexts.length = 0;
    const next = vi.fn(async (args: unknown) => {
      calls.order.push("delegate");
      return args;
    });
    const context = {
      model: "Project",
      action: "deleteMany",
      args: { where: { id: "FORCE_DELETE_ALL" } },
    };

    const result = await new AppPrismaQueryGuard().execute(context, next);

    expect(calls.order).toEqual(["timing", "tenancy", "delegate"]);
    expect(calls.contexts).toEqual([context]);
    expect(next).toHaveBeenCalledWith({ stage: "tenancy" });
    expect(result).toEqual({ stage: "tenancy" });
  });

  it("reports a model-less raw operation without inventing a model", async () => {
    calls.order.length = 0;
    calls.contexts.length = 0;

    await new AppPrismaQueryGuard().execute(
      { action: "queryRaw", args: { query: "SELECT 1" } },
      async (args) => args,
    );

    expect(calls.order).toEqual(["timing", "tenancy"]);
    expect(Object.hasOwn(calls.contexts[0]!, "model")).toBe(false);
  });
});
