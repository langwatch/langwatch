import { resolveRequestBound } from "@langwatch/plans";
/**
 * The registry enterprise ceiling is the outer validation shell for the
 * optimized-queues page size: above 400 refuses, at 400 parses. The
 * application clamps the effective take to the caller's tier.
 */
import { describe, expect, it } from "vitest";

import { annotationApiOptimizedQueuesInputSchema } from "../annotation-trpc.schemas.ts";

const ENTERPRISE_PAGE_SIZE = resolveRequestBound("annotationPageSizeMax", "ENTERPRISE");

const input = (pageSize: unknown) =>
  annotationApiOptimizedQueuesInputSchema.safeParse({
    projectId: "p1",
    selectedAnnotations: "pending",
    pageSize,
    pageOffset: 0,
  });

describe("annotationApiOptimizedQueuesInputSchema.pageSize", () => {
  it("refuses a page size above the enterprise ceiling", () => {
    expect(input(ENTERPRISE_PAGE_SIZE + 1).success).toBe(false);
  });

  it("accepts a page size at the enterprise ceiling", () => {
    expect(input(ENTERPRISE_PAGE_SIZE).success).toBe(true);
  });

  it("refuses a non-positive or fractional page size", () => {
    expect(input(0).success).toBe(false);
    expect(input(-5).success).toBe(false);
    expect(input(1.5).success).toBe(false);
  });
});

describe("annotationApiOptimizedQueuesInputSchema paging", () => {
  it("reads the first page of 25 when the caller names no page", () => {
    const parsed = annotationApiOptimizedQueuesInputSchema.parse({
      projectId: "p1",
      selectedAnnotations: "pending",
    });

    expect(parsed.pageSize).toBe(25);
    expect(parsed.pageOffset).toBe(0);
  });

  it("refuses a negative or fractional page offset", () => {
    const offset = (pageOffset: number) =>
      annotationApiOptimizedQueuesInputSchema.validate({
        projectId: "p1",
        selectedAnnotations: "pending",
        pageOffset,
      });

    expect(offset(-1)).toBe(false);
    expect(offset(1.5)).toBe(false);
  });
});
