import { describe, expect, it } from "vitest";

import { MemoryPromptTagRepository } from "../../repositories/memory/memory.prompt-tag.repository.ts";
import { MemoryPromptState } from "../../repositories/memory/memory.prompt.store.ts";
import { seedOrganizationPromptTags } from "../prompt-lifecycle.pipeline.ts";

const created = {
  tenantId: "organization_acme",
  organizationId: "organization_acme",
  organizationName: "Acme",
  occurredAt: 1,
};

function installed() {
  const repository = MemoryPromptTagRepository.create(new MemoryPromptState());
  const handle = seedOrganizationPromptTags({
    tags: { seedTagsForOrganization: (input) => repository.seedForOrg(input) },
  });
  const tagNames = async () =>
    (await repository.findAll({ organizationId: created.organizationId }))
      .map((tag) => tag.name)
      .toSorted();
  return { handle, tagNames };
}

describe("prompt's subscriber to lw.organization.created", () => {
  /** @scenario "a new organization is seeded with the production and staging prompt tags" */
  it("seeds the production and staging tags", async () => {
    const { handle, tagNames } = installed();

    await handle(created);

    expect(await tagNames()).toEqual(["production", "staging"]);
  });

  /** @scenario "a redelivered creation fact seeds no prompt tag twice" */
  it("seeds nothing twice when the fact is delivered again", async () => {
    const { handle, tagNames } = installed();

    await handle(created);
    await handle(created);

    expect(await tagNames()).toEqual(["production", "staging"]);
  });
});
