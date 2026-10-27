/**
 * @vitest-environment node
 * The page-size refusal: a page above the caller's plan bound is refused by
 * name, a page at it passes.
 */
import type { ProjectApi } from "@langwatch/project-contract";
import { TracePageSizeTooLargeError } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createTraceTestRequestBounds } from "../../../../app/__tests__/trace-bounds.fixture.ts";
import { TraceReadBoundsService } from "../trace-read-bounds.service.ts";

function boundsFor(tier: "free" | "paid" | "enterprise"): TraceReadBoundsService {
  return TraceReadBoundsService.create({
    entitlement: createTraceTestRequestBounds(tier),
    projects: { getOrganizationId: async () => "organization-1" } satisfies Pick<
      ProjectApi,
      "getOrganizationId"
    >,
  });
}

describe("TraceReadBoundsService.assertPageSizeWithinBound", () => {
  describe("given a trace list page", () => {
    it.each([
      ["free", 1_000],
      ["paid", 2_000],
      ["enterprise", 4_000],
    ] as const)(
      "refuses a %s-plan page above %i by name and passes one at it",
      async (tier, max) => {
        const bounds = boundsFor(tier);

        await expect(
          bounds.assertPageSizeWithinBound({
            projectId: "project-1",
            pageSize: max + 1,
            bound: "tracesPageSizeMax",
          }),
        ).rejects.toMatchObject({
          name: "TracePageSizeTooLargeError",
          code: "trace_page_size_too_large",
          meta: { maxPageSize: max, bound: "tracesPageSizeMax" },
        });
        await expect(
          bounds.assertPageSizeWithinBound({
            projectId: "project-1",
            pageSize: max,
            bound: "tracesPageSizeMax",
          }),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("given a trace download page", () => {
    it.each(["free", "paid", "enterprise"] as const)(
      "refuses a %s-plan download above 10 000 and passes one at it",
      async (tier) => {
        const bounds = boundsFor(tier);

        await expect(
          bounds.assertPageSizeWithinBound({
            projectId: "project-1",
            pageSize: 10_001,
            bound: "tracesDownloadPageSizeMax",
          }),
        ).rejects.toBeInstanceOf(TracePageSizeTooLargeError);
        await expect(
          bounds.assertPageSizeWithinBound({
            projectId: "project-1",
            pageSize: 10_000,
            bound: "tracesDownloadPageSizeMax",
          }),
        ).resolves.toBeUndefined();
      },
    );
  });
});
