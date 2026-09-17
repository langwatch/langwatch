import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
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
  organizationId: "org_1",
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
  const changeEvents = { append: vi.fn().mockResolvedValue({ revision: 1n }) };
  const service = new ModelProviderService({
    prisma: prisma as unknown as PrismaClient,
    repository: repository as unknown as ModelProviderRepository,
    changeEvents: changeEvents as unknown as ChangeEventRepository,
  });
  return { service, repository, changeEvents };
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

  describe("when a header arrives padded with whitespace", () => {
    /**
     * A header value goes out as an HTTP header and nothing else. Python's
     * http.client rejects a header value whose edges carry whitespace, so a
     * space a user never sees in the settings form fails every request to
     * that provider — with no query-string variant to launder it the way a
     * pasted API key has, and nothing on the page to say why.
     */
    it.each([
      ["a trailing newline", "Bearer pasted-secret\n"],
      ["a leading space", " Bearer pasted-secret"],
      ["a trailing space", "Bearer pasted-secret "],
      ["surrounding whitespace", "\t Bearer pasted-secret \r\n"],
    ])("strips %s from the value before storing it", async (_label, value) => {
      const repository = await saveWithHeaders([
        { key: "Authorization", value },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [
            { key: "Authorization", value: "Bearer pasted-secret" },
            { key: "X-Tenant", value: REAL_TENANT },
          ],
        }),
        expect.anything(),
      );
    });

    it("strips whitespace from the header name too", async () => {
      const repository = await saveWithHeaders([
        { key: " X-Trace-Id ", value: "abc123" },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [{ key: "X-Trace-Id", value: "abc123" }],
        }),
        expect.anything(),
      );
    });

    it("keeps whitespace inside a value, which is legitimate there", async () => {
      const repository = await saveWithHeaders([
        { key: "Authorization", value: " Bearer two words " },
      ]);

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [{ key: "Authorization", value: "Bearer two words" }],
        }),
        expect.anything(),
      );
    });

    it("heals a padded value restored from the stored row", async () => {
      // The padding is already in the database from an earlier save. A
      // masked placeholder restores that stored value, so without a trim
      // here the bad value survives every future save untouched.
      const { service, repository } = makeService();
      repository.findByIdForOrganization.mockResolvedValue({
        ...existingRow,
        extraHeaders: [{ key: "Authorization", value: " stored-padded " }],
      });

      await service.updateModelProvider({
        id: "mp_custom",
        projectId: "project_1",
        provider: "custom",
        enabled: true,
        extraHeaders: [{ key: "Authorization", value: MASKED_KEY_PLACEHOLDER }],
      });

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [{ key: "Authorization", value: "stored-padded" }],
        }),
        expect.anything(),
      );
    });

    it("keeps two secrets apart when trimming collapses their names", async () => {
      // Trimming can turn two names that differed only by whitespace into
      // one name. Restoring by first match would then hand the same stored
      // secret to both placeholders and drop the other secret entirely.
      const { service, repository } = makeService();
      repository.findByIdForOrganization.mockResolvedValue({
        ...existingRow,
        extraHeaders: [
          { key: "Authorization", value: "secret-one" },
          { key: " Authorization", value: "secret-two" },
        ],
      });

      await service.updateModelProvider({
        id: "mp_custom",
        projectId: "project_1",
        provider: "custom",
        enabled: true,
        extraHeaders: [
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
          { key: " Authorization", value: MASKED_KEY_PLACEHOLDER },
        ],
      });

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [
            { key: "Authorization", value: "secret-one" },
            { key: "Authorization", value: "secret-two" },
          ],
        }),
        expect.anything(),
      );
    });

    it("keeps the right secret when one of the collapsed names is renamed", async () => {
      // Two stored names collapse to one under the trim, and the first row is
      // renamed in place while the second is left masked. Matching by name
      // first would hand the second row the first row's secret, and the
      // renamed row would lose its own: its positional fallback is blocked
      // because the name it used to carry is still somewhere in the
      // submission.
      const { service, repository } = makeService();
      repository.findByIdForOrganization.mockResolvedValue({
        ...existingRow,
        extraHeaders: [
          { key: " Authorization", value: "secret-one" },
          { key: "Authorization", value: "secret-two" },
        ],
      });

      await service.updateModelProvider({
        id: "mp_custom",
        projectId: "project_1",
        provider: "custom",
        enabled: true,
        extraHeaders: [
          { key: "X-New", value: MASKED_KEY_PLACEHOLDER },
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        ],
      });

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [
            { key: "X-New", value: "secret-one" },
            { key: "Authorization", value: "secret-two" },
          ],
        }),
        expect.anything(),
      );
    });

    it("keeps the right secret when the first of the two rows is deleted", async () => {
      // The row that survives is the second one, and it submits the name it
      // has always had. Matching on trimmed names would let it land on the
      // deleted row's entry, because after trimming both rows read the same
      // and the survivor now sits where the deleted row used to be.
      const { service, repository } = makeService();
      repository.findByIdForOrganization.mockResolvedValue({
        ...existingRow,
        extraHeaders: [
          { key: " Authorization", value: "secret-one" },
          { key: "Authorization", value: "secret-two" },
        ],
      });

      await service.updateModelProvider({
        id: "mp_custom",
        projectId: "project_1",
        provider: "custom",
        enabled: true,
        extraHeaders: [{ key: "Authorization", value: MASKED_KEY_PLACEHOLDER }],
      });

      expect(repository.update).toHaveBeenCalledWith(
        "mp_custom",
        expect.objectContaining({
          extraHeaders: [{ key: "Authorization", value: "secret-two" }],
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
