import { describe, expect, it } from "vitest";

import { QueueTenantClaimsFillService } from "../queue-tenant-claims-fill.service.ts";

/** A keyspace walk of fixed slices: each cursor leads to the next, "0" ends it. */
function walkOver(slices: Record<string, { cursor: string; listed: number }>) {
  const asked: { cursor: string; maxScanCalls: number }[] = [];
  const repository = {
    async fillTenantClaims(params: { cursor: string; maxScanCalls: number }) {
      asked.push(params);
      const slice = slices[params.cursor];
      if (!slice) throw new Error(`no slice after cursor ${params.cursor}`);
      return slice;
    },
  };
  return { service: QueueTenantClaimsFillService.create({ repository }), asked };
}

describe("given the backfill step saved a cursor partway through the walk", () => {
  /** @scenario "The claimed-groups backfill resumes from its saved cursor and stops on its signal" */
  it("walks on from it in slices, saving each, and finishes at cursor 0", async () => {
    const { service, asked } = walkOver({
      "17": { cursor: "42", listed: 3 },
      "42": { cursor: "0", listed: 2 },
    });
    const saved: { cursor: string; listed: number }[] = [];

    const outcome = await service.fill({
      resumeCursor: "17",
      signal: new AbortController().signal,
      onSlice: async (progress) => void saved.push(progress),
    });

    expect(asked).toEqual([
      { cursor: "17", maxScanCalls: 200 },
      { cursor: "42", maxScanCalls: 200 },
    ]);
    expect(saved).toEqual([
      { cursor: "42", listed: 3 },
      { cursor: "0", listed: 5 },
    ]);
    expect(outcome).toEqual({ listed: 5, finished: true });
  });

  /** @scenario "The claimed-groups backfill resumes from its saved cursor and stops on its signal" */
  it("stops before the next slice once its signal aborts, and reports not finished", async () => {
    const controller = new AbortController();
    const { service, asked } = walkOver({
      "0": { cursor: "42", listed: 4 },
      "42": { cursor: "0", listed: 1 },
    });

    const outcome = await service.fill({
      resumeCursor: "0",
      signal: controller.signal,
      onSlice: async () => controller.abort(),
    });

    expect(asked.map(({ cursor }) => cursor)).toEqual(["0"]);
    expect(outcome).toEqual({ listed: 4, finished: false });
  });
});
