import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type * as Observability from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 */
import type { UpdatePromptCommand, VersionedPrompt } from "@langwatch/prompt-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import type { PromptLifecyclePipeline } from "../../eventing/prompt-lifecycle.pipeline.ts";
import { MemoryPromptRateLimitRepository } from "../../repositories/memory/memory.prompt-rate-limit.repository.ts";
import { MemoryPromptRepositories } from "../../repositories/memory/memory.prompt.repositories.ts";
import type { PromptService } from "../../services/prompt.service.ts";
import { PromptModule } from "../prompt.app.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

/** Every error line any prompt logger writes, so a lost lifecycle fact can be checked. */
const loggedErrors = vi.hoisted((): { fields: unknown; message: unknown }[] => []);
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof Observability>()),
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (fields: unknown, message: unknown) => void loggedErrors.push({ fields, message }),
  }),
}));

const lostFacts = (fact: string) =>
  loggedErrors.filter((e) => e.message === `prompt ${fact} was not recorded`);

/** A sender that records each payload it is given. */
function recorder<T>(into: unknown[], fail = false) {
  return {
    send: async (payload: T) => {
      if (fail) throw new Error("event store down");
      into.push(payload);
    },
    sendBatch: async () => {},
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

/** Lifecycle senders that record what each command was sent. */
function recordingCommands(input: {
  created?: unknown[];
  versions?: unknown[];
  deleted?: unknown[];
  fail?: boolean;
}): EventingCommands<PromptLifecyclePipeline> {
  return {
    recordPromptCreated: recorder(input.created ?? [], input.fail),
    recordPromptVersionSaved: recorder(input.versions ?? [], input.fail),
    recordPromptDeleted: recorder(input.deleted ?? [], input.fail),
  };
}

/** The fire-and-forget senders run on the microtask queue; a flush lets them land. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A source prompt as the library reads it back. Only the fields the copy rule
 * looks at carry meaning; the rest are the schema's required ones.
 */
function sourcePrompt(overrides: Partial<VersionedPrompt> = {}): VersionedPrompt {
  return {
    id: "prompt-source",
    name: "Support triage",
    handle: "support-triage",
    scope: "PROJECT",
    version: 7,
    versionId: "version-7",
    versionCreatedAt: NOW,
    model: "openai/gpt-5-mini",
    prompt: "You are a support bot.",
    projectId: "project-source",
    organizationId: "org-1",
    messages: [{ role: "user", content: "{{question}}" }],
    authorId: "user-source",
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
    updatedAt: NOW,
    createdAt: NOW,
    tags: [],
    parameters: {},
    ...overrides,
  };
}

function harness() {
  const updated = sourcePrompt({ id: "prompt-copy", projectId: "project-copy" });
  const updatePrompt = vi.fn<(input: UpdatePromptCommand) => Promise<VersionedPrompt>>(
    async () => updated,
  );

  // Only `updatePrompt` is reached: the copy rule reads its source from the
  // argument it was given rather than looking one up. The fixture rejects a
  // reach for every other method.
  const prompts = createApiFixture<PromptService>({ updatePrompt });

  const app = PromptModule.createWithPrompts(
    {
      dependencies: {
        projects: createApiFixture<ProjectApi>({
          getOrganizationId: async () => "org-1",
          listIdsByOrganization: async () => ["project-copy"],
        }),
        permissions: createApiFixture<AuthzApi>(),
        plans: createApiFixture<EntitlementApi>(),
        workflow: createApiFixture<WorkflowApi>(),
        modelProviders: defaultModelFixture(),
      },
      repositories: { rateLimits: MemoryPromptRateLimitRepository.create() },
      config: { publicBaseUrl: "https://app.langwatch.test" },
      resources: { own: () => {}, ownService: () => {} },
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    },
    prompts,
  );

  const apply = (source: VersionedPrompt) =>
    app.applySourceToCopy(
      {
        source,
        targetIdOrHandle: "prompt-copy",
        targetProjectId: "project-copy",
        commitMessage: 'Updated from source prompt "support-triage"',
      },
      { id: "user-asking" },
    );

  const writtenData = (index = 0): UpdatePromptCommand["data"] => {
    const call = updatePrompt.mock.calls[index]?.[0];
    if (!call) throw new Error("applySourceToCopy did not write to the copy");
    return call.data;
  };

  return { app, apply, updatePrompt, writtenData };
}

describe("PromptModule.applySourceToCopy", () => {
  describe("given a source that declares a response format", () => {
    it("writes the response format onto the copy", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "answer", schema: { type: "object" } },
          },
        }),
      );

      expect(writtenData().responseFormat).toEqual({
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" } },
      });
    });

    // The pull and the push differ in one thing only — how the act names
    // itself in the copy's history. Everything else a copy receives is this
    // one method, so the field cannot be carried by one path and dropped by
    // the other. That divergence is what this suite exists to keep out.
    it("writes the same content whether the act was a pull or a push", async () => {
      const { app, writtenData } = harness();
      const source = sourcePrompt({
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "verdict", schema: { type: "object" } },
        },
      });
      const target = {
        source,
        targetIdOrHandle: "prompt-copy",
        targetProjectId: "project-copy",
      };
      const by = { id: "user-asking" };

      await app.applySourceToCopy(
        { ...target, commitMessage: PromptModule.commitMessageFor("synced", source) },
        by,
      );
      await app.applySourceToCopy(
        { ...target, commitMessage: PromptModule.commitMessageFor("pushed", source) },
        by,
      );

      const { commitMessage: pulledMessage, ...pulledContent } = writtenData(0);
      const { commitMessage: pushedMessage, ...pushedContent } = writtenData(1);

      expect(pulledMessage).not.toBe(pushedMessage);
      expect(pulledContent).toEqual(pushedContent);
      expect(pulledContent.responseFormat).toEqual({
        type: "json_schema",
        json_schema: { name: "verdict", schema: { type: "object" } },
      });
    });
  });

  describe("given a source that declares no response format", () => {
    it("does not write the key at all, so the copy's own value survives", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt());

      expect(writtenData()).not.toHaveProperty("responseFormat");
    });
  });

  describe("given a source that set none of the optional sampling parameters", () => {
    it("omits every one of them rather than writing an explicit undefined", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt());

      const data = writtenData();
      for (const field of [
        "maxTokens",
        "topP",
        "frequencyPenalty",
        "presencePenalty",
        "seed",
        "topK",
        "minP",
        "repetitionPenalty",
        "reasoning",
        "verbosity",
        "promptingTechnique",
      ]) {
        expect(data, `${field} must be absent, not present and undefined`).not.toHaveProperty(
          field,
        );
      }
    });
  });

  describe("given a source that set the optional sampling parameters", () => {
    it("carries each of them onto the copy", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          maxTokens: 512,
          topP: 0.9,
          frequencyPenalty: 0.1,
          presencePenalty: 0.2,
          seed: 42,
          topK: 5,
          minP: 0.05,
          repetitionPenalty: 1.1,
          reasoning: "medium",
          verbosity: "low",
          promptingTechnique: { type: "chain_of_thought" },
        }),
      );

      expect(writtenData()).toMatchObject({
        maxTokens: 512,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 42,
        topK: 5,
        minP: 0.05,
        repetitionPenalty: 1.1,
        reasoning: "medium",
        verbosity: "low",
        promptingTechnique: { type: "chain_of_thought" },
      });
    });
  });

  describe("given a source whose prompt and messages both carry a system message", () => {
    it("hoists the message so the copy is not written a conflicting pair", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          prompt: "stale prompt column",
          messages: [
            { role: "system", content: "authoritative system message" },
            { role: "user", content: "{{question}}" },
          ],
        }),
      );

      const data = writtenData();
      expect(data.prompt).toBe("authoritative system message");
      expect(data.messages).toEqual([{ role: "user", content: "{{question}}" }]);
    });
  });

  describe("given a caller", () => {
    it("attributes the copy's new version to them and not to the source's author", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt({ authorId: "user-source" }));

      expect(writtenData().authorId).toBe("user-asking");
    });
  });

  describe("when the copy is named", () => {
    it("writes to the target prompt in the target project, not the source's", async () => {
      const { apply, updatePrompt } = harness();

      await apply(sourcePrompt());

      expect(updatePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          idOrHandle: "prompt-copy",
          projectId: "project-copy",
        }),
      );
    });
  });
});

describe("PromptModule.commitMessageFor", () => {
  describe("given a source that has a handle", () => {
    it("names the source by its handle for a pull", () => {
      expect(
        PromptModule.commitMessageFor("synced", { id: "prompt-source", handle: "support-triage" }),
      ).toBe('Updated from source prompt "support-triage"');
    });

    it("names the source by its handle for a push", () => {
      expect(
        PromptModule.commitMessageFor("pushed", { id: "prompt-source", handle: "support-triage" }),
      ).toBe('Pushed from source prompt "support-triage"');
    });
  });

  describe("given a source that has no handle", () => {
    it("falls back to the source's id", () => {
      expect(PromptModule.commitMessageFor("synced", { id: "prompt-source", handle: null })).toBe(
        'Updated from source prompt "prompt-source"',
      );
    });
  });
});

describe("PromptModule.create", () => {
  describe("given its declared repository bundle", () => {
    it("builds a working engine over memory repositories", async () => {
      const app = PromptModule.create({
        dependencies: {
          projects: createApiFixture<ProjectApi>({
            getOrganizationId: async () => "org-1",
            listIdsByOrganization: async () => [],
          }),
          permissions: createApiFixture<AuthzApi>(),
          plans: createApiFixture<EntitlementApi>(),
          workflow: createApiFixture<WorkflowApi>(),
          modelProviders: defaultModelFixture(),
        },
        config: { publicBaseUrl: "https://app.langwatch.test" },
        resources: { own: () => {}, ownService: () => {} },
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
        repositories: MemoryPromptRepositories.create(),
      });

      await expect(
        app.getAllPrompts({ projectId: "project-1", organizationId: "org-1" }),
      ).resolves.toEqual([]);

      // Announcing before the pipeline connects its senders never throws:
      // `announceCreated` is fire-and-forget (@scenario "Prompt creation
      // tracked regardless of whether created via platform UI or API").
      expect(() =>
        app.announceCreated({ projectId: "project-1", promptId: "prompt-1", userId: "user-1" }),
      ).not.toThrow();
    });
  });

  describe("given its lifecycle pipeline is connected", () => {
    /** @scenario "Prompt creation tracked regardless of whether created via platform UI or API" */
    it("resolves the org admin and sends the count when the write carried no user", async () => {
      const sent: unknown[] = [];
      const commands = recordingCommands({ created: sent });

      const app = PromptModule.create({
        dependencies: {
          projects: createApiFixture<ProjectApi>({
            getOrganizationId: async () => "org-1",
            listIdsByOrganization: async () => [],
            resolveOrgAdmin: async () => ({
              userId: "org-admin",
              organizationId: "org-1",
              firstMessage: false,
              onboardingVariant: null,
              organizationCreatedAt: null,
            }),
          }),
          permissions: createApiFixture<AuthzApi>(),
          plans: createApiFixture<EntitlementApi>(),
          workflow: createApiFixture<WorkflowApi>(),
          modelProviders: defaultModelFixture(),
        },
        config: { publicBaseUrl: "https://app.langwatch.test" },
        resources: { own: () => {}, ownService: () => {} },
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
        repositories: MemoryPromptRepositories.create(),
      });
      app.connectLifecycleCommands(commands);

      const created = await app.createPrompt({
        projectId: "project-1",
        organizationId: "org-1",
        handle: "support-triage",
        prompt: "You are a support bot.",
      });

      // The REST/CLI door announces with no user; the fire-and-forget chain
      // runs on the microtask queue, so a flush lets it land before the assert.
      app.announceCreated({ projectId: "project-1", promptId: created.id });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent).toEqual([
        expect.objectContaining({
          promptId: created.id,
          projectId: "project-1",
          userId: "org-admin",
          orgPromptCount: 1,
        }),
      ]);
    });
  });
});

describe("PromptModule lifecycle facts", () => {
  function connected(options: { fail?: boolean } = {}) {
    const versions: unknown[] = [];
    const deleted: unknown[] = [];
    const repositories = MemoryPromptRepositories.create();
    const app = PromptModule.create({
      dependencies: {
        projects: createApiFixture<ProjectApi>({
          getOrganizationId: async () => "org-1",
          listIdsByOrganization: async () => [],
        }),
        permissions: createApiFixture<AuthzApi>(),
        plans: createApiFixture<EntitlementApi>(),
        workflow: createApiFixture<WorkflowApi>(),
        modelProviders: defaultModelFixture(),
      },
      config: { publicBaseUrl: "https://app.langwatch.test" },
      resources: { own: () => {}, ownService: () => {} },
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      repositories,
    });
    app.connectLifecycleCommands(recordingCommands({ versions, deleted, fail: options.fail }));
    const createOne = () =>
      app.createPrompt({
        projectId: "project-1",
        organizationId: "org-1",
        handle: "support-triage",
        prompt: "You are a support bot.",
      });
    return { app, versions, deleted, createOne, repositories };
  }

  /** @scenario "saving a new version of a prompt records that a version was saved" */
  it("records one version saved fact with ids only when a prompt is updated", async () => {
    const { app, versions, createOne } = connected();
    const created = await createOne();

    const saved = await app.update(
      {
        idOrHandle: created.id,
        projectId: "project-1",
        data: { commitMessage: "Tighter tone", prompt: "You are a terse support bot." },
      },
      { id: "user-1" },
    );
    await flush();

    expect(versions).toEqual([
      {
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        promptId: created.id,
        projectId: "project-1",
        versionId: saved.versionId,
        authorId: "user-1",
      },
    ]);
  });

  /** @scenario "restoring an earlier version records the restored copy as a saved version" */
  it("records one version saved fact for the new version a restore writes", async () => {
    const { app, versions, createOne } = connected();
    const created = await createOne();

    const restored = await app.restoreVersion(
      { versionId: created.versionId, projectId: "project-1" },
      { id: "user-1" },
    );
    await flush();

    expect(restored.versionId).not.toBe(created.versionId);
    expect(versions).toEqual([
      expect.objectContaining({ promptId: created.id, versionId: restored.versionId }),
    ]);
  });

  /** @scenario "restoring an earlier version records the restored copy as a saved version" */
  it("records the version the restore wrote even when another save lands right after it", async () => {
    const { app, versions, createOne, repositories } = connected();
    const created = await createOne();
    const store = repositories.configs.versions;
    const write = store.restoreVersion.bind(store);
    let restoredRowId = "";
    let concurrentVersionId = "";
    vi.spyOn(store, "restoreVersion").mockImplementation(async (params) => {
      const row = await write(params);
      restoredRowId = row.id;
      const concurrent = await app.update(
        { idOrHandle: created.id, projectId: "project-1", data: { commitMessage: "Meanwhile" } },
        { id: "user-2" },
      );
      concurrentVersionId = concurrent.versionId;
      return row;
    });

    const restored = await app.restoreVersion(
      { versionId: created.versionId, projectId: "project-1" },
      { id: "user-1" },
    );
    await flush();

    expect(restored.versionId).toBe(restoredRowId);
    expect(restoredRowId).not.toBe(concurrentVersionId);
    expect(versions).toEqual([
      expect.objectContaining({ versionId: concurrentVersionId, authorId: "user-2" }),
      expect.objectContaining({ versionId: restoredRowId, authorId: "user-1" }),
    ]);
  });

  /** @scenario "updating a prompt through the REST API records one saved version" */
  it("records one version saved fact when the REST update writes a version", async () => {
    const { app, versions, createOne } = connected();
    const created = await createOne();

    const updated = await app.updateWithTags({
      idOrHandle: created.id,
      projectId: "project-1",
      organizationId: "org-1",
      data: { commitMessage: "From the SDK", prompt: "You are a calm support bot." },
    });
    await flush();

    expect(versions).toEqual([
      expect.objectContaining({ promptId: created.id, versionId: updated.versionId }),
    ]);
  });

  /** @scenario "syncing a prompt from the CLI records a saved version only when it writes one" */
  it("records one version saved fact for a sync that updates and none for one that is up to date", async () => {
    const { app, versions, createOne } = connected();
    const created = await createOne();
    const localConfigData = {
      model: "gpt-4",
      prompt: "You are a synced support bot.",
      messages: [],
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
    };

    const first = await app.syncAndAnnounce({
      idOrHandle: created.id,
      projectId: "project-1",
      organizationId: "org-1",
      localConfigData,
      localVersion: created.version,
    });
    const second = await app.syncAndAnnounce({
      idOrHandle: created.id,
      projectId: "project-1",
      organizationId: "org-1",
      localConfigData,
      localVersion: first.prompt?.version,
    });
    await flush();

    expect([first.action, second.action]).toEqual(["updated", "up_to_date"]);
    expect(versions).toEqual([
      expect.objectContaining({ promptId: created.id, versionId: first.prompt?.versionId }),
    ]);
  });

  /** @scenario "pushing or syncing a source onto a copy records a saved version on the copy" */
  it("records one version saved fact for the copy, in the copy's project", async () => {
    const { app, apply } = harness();
    const versions: unknown[] = [];
    app.connectLifecycleCommands(recordingCommands({ versions }));

    await apply(sourcePrompt());
    await flush();

    expect(versions).toEqual([
      expect.objectContaining({
        tenantId: "project-copy",
        promptId: "prompt-copy",
        projectId: "project-copy",
        versionId: "version-7",
      }),
    ]);
  });

  /** @scenario "creating a prompt records no saved version" */
  it("records no version saved fact for a prompt's first version", async () => {
    const { versions, createOne } = connected();

    await createOne();
    await flush();

    expect(versions).toEqual([]);
  });

  /** @scenario "deleting a prompt by its handle records that the prompt was deleted" */
  it("records one deleted fact carrying the prompt id when deleted by handle", async () => {
    const { app, deleted, createOne } = connected();
    const created = await createOne();

    await app.delete({ idOrHandle: "support-triage", projectId: "project-1" });
    await flush();

    expect(deleted).toEqual([
      {
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        promptId: created.id,
        projectId: "project-1",
      },
    ]);
  });

  /** @scenario "a lost lifecycle fact never fails the write" */
  it("logs exactly one error with its ids for each lost fact", async () => {
    const { app, createOne } = connected({ fail: true });
    const created = await createOne();
    loggedErrors.length = 0;

    const saved = await app.update(
      { idOrHandle: created.id, projectId: "project-1", data: { commitMessage: "Edit" } },
      { id: "user-1" },
    );
    await app.delete({ idOrHandle: created.id, projectId: "project-1" });
    await flush();

    expect(lostFacts("version_saved")).toEqual([
      {
        fields: expect.objectContaining({
          tenantId: "project-1",
          projectId: "project-1",
          promptId: created.id,
          versionId: saved.versionId,
        }),
        message: "prompt version_saved was not recorded",
      },
    ]);
    expect(lostFacts("deleted")).toEqual([
      {
        fields: expect.objectContaining({
          tenantId: "project-1",
          projectId: "project-1",
          promptId: created.id,
        }),
        message: "prompt deleted was not recorded",
      },
    ]);
  });

  /** @scenario "a lost lifecycle fact never fails the write" */
  it("saves and deletes even when every send fails", async () => {
    const { app, versions, deleted, createOne } = connected({ fail: true });
    const created = await createOne();

    const saved = await app.update(
      { idOrHandle: created.id, projectId: "project-1", data: { commitMessage: "Edit" } },
      { id: "user-1" },
    );
    const removed = await app.delete({ idOrHandle: created.id, projectId: "project-1" });
    await flush();

    expect(saved.id).toBe(created.id);
    expect(removed.success).toBe(true);
    expect([...versions, ...deleted]).toEqual([]);
  });
});
