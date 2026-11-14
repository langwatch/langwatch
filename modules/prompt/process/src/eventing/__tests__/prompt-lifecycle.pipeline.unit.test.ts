import { createTenantId } from "@langwatch/eventing";
import {
  PROMPT_DELETED_EVENT_TYPE,
  PROMPT_VERSION_SAVED_EVENT_TYPE,
} from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { MemoryPromptTagRepository } from "../../repositories/memory/memory.prompt-tag.repository.ts";
import { MemoryPromptState } from "../../repositories/memory/memory.prompt.store.ts";
import {
  RecordPromptDeletedCommand,
  RecordPromptVersionSavedCommand,
  type RecordPromptDeletedCommandData,
  type RecordPromptVersionSavedCommandData,
} from "../prompt-lifecycle.commands.ts";
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

const SAVED: RecordPromptVersionSavedCommandData = {
  tenantId: "project-1",
  promptId: "prompt-1",
  projectId: "project-1",
  versionId: "version-2",
  occurredAt: 5,
};
const DELETED: RecordPromptDeletedCommandData = {
  tenantId: "project-1",
  promptId: "prompt-1",
  projectId: "project-1",
  occurredAt: 5,
};

function saved(data: RecordPromptVersionSavedCommandData) {
  const [event] = new RecordPromptVersionSavedCommand().handle({
    tenantId: createTenantId(data.tenantId),
    type: "lw.prompt.record_version_saved",
    aggregateId: data.promptId,
    data,
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

function deleted(data: RecordPromptDeletedCommandData) {
  const [event] = new RecordPromptDeletedCommand().handle({
    tenantId: createTenantId(data.tenantId),
    type: "lw.prompt.record_deleted",
    aggregateId: data.promptId,
    data,
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("prompt's lifecycle commands", () => {
  /** @scenario "a redelivered lifecycle command records nothing new" */
  it("keys a saved version to its version, so a resend adds nothing", () => {
    const first = saved(SAVED);
    const again = saved(SAVED);
    const other = saved({ ...SAVED, versionId: "version-3" });

    expect(first).toMatchObject({
      type: PROMPT_VERSION_SAVED_EVENT_TYPE,
      version: "2026-11-09",
      aggregateType: "prompt",
      aggregateId: "prompt-1",
      idempotencyKey: "project-1:prompt-1:version:version-2",
    });
    expect(again.idempotencyKey).toBe(first.idempotencyKey);
    expect(other.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  /** @scenario "a redelivered lifecycle command records nothing new" */
  it("keys a deletion to the prompt, so a resend adds nothing", () => {
    const first = deleted(DELETED);
    const again = deleted(DELETED);

    expect(first).toMatchObject({
      type: PROMPT_DELETED_EVENT_TYPE,
      version: "2026-11-09",
      aggregateType: "prompt",
      aggregateId: "prompt-1",
      idempotencyKey: "project-1:prompt-1:deleted",
      data: { promptId: "prompt-1", projectId: "project-1", occurredAt: 5 },
    });
    expect(again.idempotencyKey).toBe(first.idempotencyKey);
  });
});
