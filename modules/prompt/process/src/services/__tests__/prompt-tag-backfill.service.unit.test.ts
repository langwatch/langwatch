import { describe, expect, it } from "vitest";

import { MemoryPromptTagRepository } from "../../repositories/memory/memory.prompt-tag.repository.ts";
import { MemoryPromptState } from "../../repositories/memory/memory.prompt.store.ts";
import { PromptTagBackfillService } from "../prompt-tag-backfill.service.ts";

function installed() {
  const tags = MemoryPromptTagRepository.create(new MemoryPromptState());
  return { tags, backfill: PromptTagBackfillService.create({ peers: { tags } }) };
}

describe("PromptTagBackfillService", () => {
  /** @scenario "The deploy backfill seeds prompt tags only for organizations with none" */
  it("seeds an untagged organization once and leaves a tagged one alone", async () => {
    const { tags, backfill } = installed();
    await tags.create({ organizationId: "organization-custom", name: "canary" });
    const pass = () =>
      Promise.all(
        ["organization-untagged", "organization-custom"].map((organizationId) =>
          backfill.seedTenant({ organizationId, dryRun: false }),
        ),
      );

    await expect(pass()).resolves.toEqual([{ seeded: true }, { seeded: false }]);
    await expect(pass()).resolves.toEqual([{ seeded: false }, { seeded: false }]);
    await expect(tags.findAll({ organizationId: "organization-untagged" })).resolves.toMatchObject([
      { name: "production" },
      { name: "staging" },
    ]);
    await expect(tags.findAll({ organizationId: "organization-custom" })).resolves.toMatchObject([
      { name: "canary" },
    ]);
  });

  /** @scenario "A dry run of the deploy backfill writes no prompt tag" */
  it("reports a dry-run seed without writing", async () => {
    const { tags, backfill } = installed();

    await expect(
      backfill.seedTenant({ organizationId: "organization-untagged", dryRun: true }),
    ).resolves.toEqual({ seeded: true });
    await expect(tags.findAll({ organizationId: "organization-untagged" })).resolves.toEqual([]);
  });
});
