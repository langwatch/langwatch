/**
 * The project's Langy model list as the credential service saves and reads it back.
 * @vitest-environment node
 * @see specs/langy/langy-model-allowlist.feature
 */
import { LangyVirtualKeyMissingError } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyCredentialRepository } from "../../repositories/memory/memory.langy-credential.repository.ts";
import {
  LangyCredentialService,
  type LangyVirtualKeyService,
} from "../langy-credential.service.ts";

const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "org_1";

/**
 * A gateway stand-in: provisioning adds a live Langy key unless a stale secret makes it keep
 * none, and a write lands on every live one.
 */
function setup({
  provisioned,
  staleSecret = false,
}: {
  provisioned: boolean;
  staleSecret?: boolean;
}) {
  const store = LangyMemoryStore.create();
  store.projects.set(PROJECT_ID, {
    teamId: "team_1",
    organizationId: ORGANIZATION_ID,
    egressAllowlist: null,
  });
  const provisions: string[] = [];
  const addKey = () =>
    store.virtualKeys.push({
      organizationId: ORGANIZATION_ID,
      purpose: "LANGY",
      status: "ACTIVE",
      projectIds: [PROJECT_ID],
      updatedAt: store.virtualKeys.length,
      config: { modelsAllowed: null },
    });
  if (provisioned) addKey();
  const virtualKeys: LangyVirtualKeyService = {
    provision: async ({ projectId }) => {
      provisions.push(projectId);
      if (!staleSecret) addKey();
      return "vk-secret";
    },
    setModelsAllowed: async ({ projectId, modelsAllowed }) => {
      const live = store.virtualKeys.filter((key) => key.projectIds.includes(projectId));
      for (const key of live) key.config = { modelsAllowed };
      return { written: live.length };
    },
  };
  const service = LangyCredentialService.create({
    repository: MemoryLangyCredentialRepository.create(store),
    sessionKeys: {
      mint: async () => ({ token: "", apiKeyId: "" }),
      revokeManaged: async () => "revoked",
    },
    virtualKeys,
    github: { enabled: false, findTurnTokens: async () => [] },
    runtime: {
      workerCallbackUrl: undefined,
      workerGatewayBaseUrl: undefined,
      mirrorProjectId: undefined,
    },
  });

  return { service, store, provisions };
}

function save(service: LangyCredentialService, modelsAllowed: string[]) {
  return service.setModelsAllowedForProject({
    projectId: PROJECT_ID,
    actorUserId: "user_1",
    modelsAllowed,
  });
}

describe("LangyCredentialService.setModelsAllowedForProject", () => {
  describe("given a project that has no Langy key yet", () => {
    /** @scenario "Saving the list before Langy ever ran provisions its key first" */
    it("provisions the key, then writes the list onto it", async () => {
      const { service, provisions } = setup({ provisioned: false });

      await expect(save(service, ["openai/gpt-5"])).resolves.toEqual(["openai/gpt-5"]);
      expect(provisions).toEqual([PROJECT_ID]);
      await expect(service.findModelsAllowedForProject(PROJECT_ID)).resolves.toEqual([
        "openai/gpt-5",
      ]);
    });
  });

  describe("given a project whose Langy key was revoked while its secret is still stored", () => {
    /** @scenario "Saving refuses when no Langy key can hold the list" */
    it("refuses the save instead of answering success", async () => {
      const { service, provisions } = setup({ provisioned: false, staleSecret: true });

      await expect(save(service, ["openai/gpt-5"])).rejects.toBeInstanceOf(
        LangyVirtualKeyMissingError,
      );
      expect(provisions).toEqual([PROJECT_ID]);
    });
  });

  describe("given a project whose Langy key exists", () => {
    /** @scenario "The saved list reads back trimmed and without duplicates" */
    it("trims and deduplicates the list, minting nothing", async () => {
      const { service, provisions } = setup({ provisioned: true });

      await expect(
        save(service, [" openai/gpt-5 ", "openai/gpt-5", "openai/gpt-5-mini"]),
      ).resolves.toEqual(["openai/gpt-5", "openai/gpt-5-mini"]);
      expect(provisions).toEqual([]);
    });

    /** @scenario "Clearing the list lets Langy use every model again" */
    it("reads an empty list back as every model", async () => {
      const { service, store } = setup({ provisioned: true });
      await save(service, ["openai/gpt-5"]);

      await expect(save(service, [])).resolves.toEqual([]);
      expect(store.virtualKeys[0]?.config).toEqual({ modelsAllowed: null });
    });
  });
});
