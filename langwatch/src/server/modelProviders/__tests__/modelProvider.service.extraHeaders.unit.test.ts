import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import type { ModelProviderRepository } from "../modelProvider.repository";
import { ModelProviderService } from "../modelProvider.service";

// The onboarding seed runs inside createNew's transaction and would drag
// half the ModelDefault stack into this suite — not what it pins down.
vi.mock("../seedOnboardingDefaults", () => ({
  seedOnboardingDefaultsForProvider: vi.fn(),
}));

const REAL_AUTH = "Bearer real-secret-abc";
const REAL_TENANT = "tenant-42";

const existingRow = {
  id: "mp_custom",
  name: "Custom",
  provider: "custom",
  enabled: true,
  customKeys: null,
  customModels: null,
  customEmbeddingsModels: null,
  deploymentMapping: null,
  extraHeaders: [
    { key: "Authorization", value: REAL_AUTH },
    { key: "X-Tenant", value: REAL_TENANT },
  ],
  scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
};

function makeService() {
  const repository = {
    findByIdForOrganization: vi.fn().mockResolvedValue(existingRow),
    update: vi.fn().mockResolvedValue(existingRow),
    create: vi.fn().mockResolvedValue(existingRow),
  };
  const prisma = {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ team: { organizationId: "org_1" } }),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
  const service = new ModelProviderService(
    prisma as unknown as PrismaClient,
    repository as unknown as ModelProviderRepository,
  );
  return { service, repository };
}

async function saveWithHeaders(
  extraHeaders: { key: string; value: string }[],
  { id }: { id?: string } = { id: "mp_custom" },
) {
  const { service, repository } = makeService();
  await service.updateModelProvider({
    id,
    projectId: "project_1",
    provider: "custom",
    enabled: true,
    extraHeaders,
  });
  return repository;
}

describe("ModelProviderService extraHeaders save path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when a save echoes masked placeholders back for untouched headers", () => {
    /** @scenario Preserve original extra header values when saving with masked placeholders */
    it("restores the stored values by header key", async () => {
      const repository = await saveWithHeaders([
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        "project_1",
        expect.objectContaining({
          extraHeaders: [
            { key: "Authorization", value: REAL_AUTH },
            { key: "X-Tenant", value: REAL_TENANT },
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe("when a header key is renamed in place with its value still masked", () => {
    it("restores the value from the header at the same position", async () => {
      const repository = await saveWithHeaders([
        { key: "X-Auth", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        "project_1",
        expect.objectContaining({
          extraHeaders: [
            { key: "X-Auth", value: REAL_AUTH },
            { key: "X-Tenant", value: REAL_TENANT },
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe("when a rename and a reorder land in the same save", () => {
    it("never copies a secret that is already claimed by name under a new header key", async () => {
      // "X-New" sits at index 0, where "Authorization" used to be — but
      // Authorization is still claimed by name at index 1, so X-New must
      // not receive its secret via the positional fallback.
      const repository = await saveWithHeaders([
        { key: "X-New", value: MASKED_KEY_PLACEHOLDER },
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        "project_1",
        expect.objectContaining({
          extraHeaders: [{ key: "Authorization", value: REAL_AUTH }],
        }),
        expect.anything(),
      );
    });
  });

  describe("when a masked placeholder matches no stored header at all", () => {
    /** @scenario Preserve original extra header values when saving with masked placeholders */
    it("drops the header instead of persisting the placeholder literally", async () => {
      const repository = await saveWithHeaders([
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Never-Stored", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        "project_1",
        expect.objectContaining({
          extraHeaders: [
            { key: "Authorization", value: REAL_AUTH },
            { key: "X-Tenant", value: REAL_TENANT },
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe("when the user enters a new header value", () => {
    it("saves the entered value verbatim", async () => {
      const repository = await saveWithHeaders([
        { key: "Authorization", value: "Bearer replaced-secret" },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        "project_1",
        expect.objectContaining({
          extraHeaders: [
            { key: "Authorization", value: "Bearer replaced-secret" },
            { key: "X-Tenant", value: REAL_TENANT },
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe("when creating a new provider with a masked placeholder value", () => {
    it("drops the placeholder — there is no stored row to restore from", async () => {
      const repository = await saveWithHeaders(
        [
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Real", value: "real-value" },
        ],
        { id: undefined },
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          extraHeaders: [{ key: "X-Real", value: "real-value" }],
        }),
        expect.anything(),
      );
    });
  });
});
