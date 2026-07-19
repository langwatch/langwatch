import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterService } from "~/server/filters/filter.service";
import { createInnerTRPCContext, createTRPCRouter } from "../../../trpc";
import { dataForFilter } from "../dataForFilter";

vi.mock("../../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../rbac")>();
  return {
    ...actual,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("~/server/filters/filter.service", () => ({
  FilterService: {
    create: vi.fn(),
  },
}));

vi.mock("../../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const getFilterOptions = vi.fn();
const mockedCreate = vi.mocked(FilterService.create);

const testRouter = createTRPCRouter({ dataForFilter });

function buildCaller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user-1" }, expires: "1" } as any,
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return testRouter.createCaller(ctx);
}

const baseInput = {
  projectId: "project-1",
  startDate: 1_000,
  endDate: 2_000,
};

describe("dataForFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFilterOptions.mockResolvedValue([
      { field: "opt", label: "Opt", count: 1 },
    ]);
    mockedCreate.mockReturnValue({ getFilterOptions } as any);
  });

  describe("when the requested field is present in the scope filters", () => {
    it("excludes it from scopeFilters to avoid the circular dependency, keeping other fields", async () => {
      const caller = buildCaller();

      const result = await caller.dataForFilter({
        ...baseInput,
        field: "topics.topics",
        filters: {
          "topics.topics": ["topic-1"],
          "spans.model": ["gpt-5-mini"],
        },
      });

      expect(getFilterOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          field: "topics.topics",
          scopeFilters: { "spans.model": ["gpt-5-mini"] },
        }),
      );
      expect(result).toEqual({
        options: [{ field: "opt", label: "Opt", count: 1 }],
      });
    });
  });

  describe("when a requiresKey filter is requested without a key", () => {
    it("rejects with BAD_REQUEST before hitting the service", async () => {
      const caller = buildCaller();

      const error = await caller
        .dataForFilter({
          ...baseInput,
          field: "metadata.value",
          filters: {},
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect(getFilterOptions).not.toHaveBeenCalled();
    });
  });

  describe("when a requiresSubkey filter is requested without a subkey", () => {
    it("rejects with BAD_REQUEST before hitting the service", async () => {
      const caller = buildCaller();

      const error = await caller
        .dataForFilter({
          ...baseInput,
          field: "events.metrics.value",
          key: "purchase",
          filters: {},
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect(getFilterOptions).not.toHaveBeenCalled();
    });
  });
});
