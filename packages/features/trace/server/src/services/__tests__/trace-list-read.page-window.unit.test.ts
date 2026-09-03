/**
 * @vitest-environment node
 *
 * The position window on the flat trace list: a numbered jump lands on
 * `(page - 1) * pageSize` and ClickHouse pays for every skipped row, so
 * position reads stop at {@link TRACE_LIST_MAX_OFFSET_ROWS}. A cursor read is
 * keyset and pays nothing for depth, so it passes at any page number.
 *
 * See specs/components/pagination.feature.
 */
import { describe, expect, it, vi } from "vitest";
import { TRACE_LIST_MAX_OFFSET_ROWS } from "@langwatch/trace-contract";

import { TraceListService } from "../trace-list-read.service";

function serviceWithRepository(findAll: ReturnType<typeof vi.fn>) {
  return new TraceListService(
    { findAll } as never,
    { findSummariesByTraceIds: vi.fn().mockResolvedValue({}) } as never,
    { getNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
  );
}

const listParams = {
  tenantId: "tenant-1",
  timeRange: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
  sort: { columnId: "timestamp", direction: "desc" as const },
  pageSize: 50,
};

describe("TraceListService.getList position window", () => {
  describe("given a page whose rows sit past the window", () => {
    /** @scenario "A position read past the window is refused" */
    it("refuses the read without touching the repository, naming the window", async () => {
      const findAll = vi.fn();
      const service = serviceWithRepository(findAll);

      const pastTheWindow =
        TRACE_LIST_MAX_OFFSET_ROWS / listParams.pageSize + 1;
      await expect(
        service.getList({ ...listParams, page: pastTheWindow }),
      ).rejects.toMatchObject({
        code: "page_too_deep",
        meta: { maxRows: TRACE_LIST_MAX_OFFSET_ROWS },
      });
      expect(findAll).not.toHaveBeenCalled();
    });
  });

  describe("given the same depth carried by a cursor", () => {
    it("reads it, because keyset depth costs nothing", async () => {
      const findAll = vi
        .fn()
        .mockResolvedValue({ rows: [], totalHits: 500_000 });
      const service = serviceWithRepository(findAll);

      await service.getList({
        ...listParams,
        page: TRACE_LIST_MAX_OFFSET_ROWS,
        cursor: { sortValue: 1_700_000_000_500, traceId: "trace-a" },
      });

      expect(findAll).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0 }),
      );
    });
  });

  describe("given a page whose last row is exactly the window's edge", () => {
    it("still reads it", async () => {
      const findAll = vi
        .fn()
        .mockResolvedValue({ rows: [], totalHits: 500_000 });
      const service = serviceWithRepository(findAll);

      const edgePage = TRACE_LIST_MAX_OFFSET_ROWS / listParams.pageSize;
      await service.getList({ ...listParams, page: edgePage });

      expect(findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: TRACE_LIST_MAX_OFFSET_ROWS - listParams.pageSize,
        }),
      );
    });
  });
});
