/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { memoryVirtualKeySeed } from "../../../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayVirtualKeyRepository } from "../../../../repositories/memory/memory.gateway-virtual-key.repository.ts";
import { MemoryGatewayStore } from "../../../../repositories/memory/memory.gateway.store.ts";
import {
  VirtualKeyPersonalMarkService,
  type VirtualKeyPersonalMarkReport,
} from "../virtual-key-personal-mark.service.ts";

const ORG_ID = "org_1";

/** Keys as the release before the mark wrote them: a principal on two, none on the third. */
async function storeBeforeTheMark() {
  const store = MemoryGatewayStore.create();
  const virtualKeys = MemoryGatewayVirtualKeyRepository.create(store);
  for (const [id, principalUserId] of [
    ["vk_a", "usr_a"],
    ["vk_b", "usr_b"],
    ["vk_shared", null],
  ] as const) {
    await virtualKeys.create({
      ...memoryVirtualKeySeed({ id, name: id, organizationId: ORG_ID }),
      principalUserId,
    });
  }
  store.mintedAsPersonal.clear();
  const saved: VirtualKeyPersonalMarkReport[] = [];
  const service = VirtualKeyPersonalMarkService.create({ virtualKeys });
  const run = (input: { dryRun?: boolean; resumeFrom?: VirtualKeyPersonalMarkReport }) =>
    service.markPersonalKeys({
      dryRun: input.dryRun ?? false,
      signal: new AbortController().signal,
      resumeFrom: input.resumeFrom ?? null,
      onPageDone: async (report) => {
        saved.push(report);
      },
    });

  return { store, saved, run };
}

describe("the personal-key mark step", () => {
  describe("given keys minted for a person before the mark existed", () => {
    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("marks each key with a principal, saving progress after the page, and leaves the rest", async () => {
      const { store, saved, run } = await storeBeforeTheMark();

      const report = await run({});

      expect([...store.mintedAsPersonal]).toEqual(["vk_a", "vk_b"]);
      expect(report).toEqual({ afterId: "vk_b", marked: 2 });
      expect(saved).toEqual([{ afterId: "vk_b", marked: 2 }]);
    });

    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("marks nothing on a second run", async () => {
      const { run } = await storeBeforeTheMark();
      await run({});

      const again = await run({});

      expect(again.marked).toBe(0);
    });

    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("marks nothing and saves no progress on a dry run, while reporting what it would mark", async () => {
      const { store, saved, run } = await storeBeforeTheMark();

      const report = await run({ dryRun: true });

      expect(store.mintedAsPersonal.size).toBe(0);
      expect(saved).toEqual([]);
      expect(report.marked).toBe(2);
    });

    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("resumes after the key its checkpoint names, counting on from the total it saved", async () => {
      const { store, saved, run } = await storeBeforeTheMark();

      const report = await run({ resumeFrom: { afterId: "vk_a", marked: 1 } });

      expect([...store.mintedAsPersonal]).toEqual(["vk_b"]);
      expect(report).toEqual({ afterId: "vk_b", marked: 2 });
      expect(saved).toEqual([{ afterId: "vk_b", marked: 2 }]);
    });
  });
});
