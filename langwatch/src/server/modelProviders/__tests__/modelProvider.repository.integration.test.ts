/**
 * @vitest-environment node
 *
 * Integration tests for ModelProviderRepository encryption.
 * Tests real database operations with real AES-256-GCM encryption.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ModelProviderRepository } from "../modelProvider.repository";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "../../../utils/constants";
import main from "../../../tasks/migrateModelProviderKeys";

const projectId = "test-project-id";

describe("ModelProviderRepository Integration", () => {
  const repository = new ModelProviderRepository(prisma);
  const createdProviderIds: string[] = [];

  beforeAll(async () => {
    await getTestUser();

    // Ensure CREDENTIALS_SECRET is set for encryption
    if (!process.env.CREDENTIALS_SECRET) {
      process.env.CREDENTIALS_SECRET =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
  });

  afterAll(async () => {
    if (createdProviderIds.length > 0) {
      await prisma.modelProvider.deleteMany({
        where: { id: { in: createdProviderIds }, projectId },
      });
    }
  });

  describe("given a model provider with customKeys", () => {
    describe("when saved and read back through the repository", () => {
      it("encrypts on save and decrypts on read preserving original values", async () => {
        const created = await repository.create({
          projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-test-key-123" },
        });
        createdProviderIds.push(created.id);

        // Read back through repository (decrypts)
        const found = await repository.findById(created.id, projectId);

        expect(found).not.toBeNull();
        expect(
          (found!.customKeys as Record<string, unknown>).OPENAI_API_KEY
        ).toBe("sk-test-key-123");

        // Read raw from prisma to verify DB value is encrypted
        const rawRow = await prisma.modelProvider.findFirst({
          where: { id: created.id, projectId },
          select: { customKeys: true },
        });

        expect(typeof rawRow!.customKeys).toBe("string");

        const rawString = rawRow!.customKeys as string;
        const parts = rawString.split(":");
        expect(parts).toHaveLength(3); // iv:encrypted:authTag
      });
    });
  });

  describe("given a model provider with plaintext customKeys in the database (pre-migration)", () => {
    describe("when read through the repository", () => {
      it("returns decrypted keys without error (backward compatibility)", async () => {
        const id = generate(KSUID_RESOURCES.MODEL_PROVIDER).toString();
        createdProviderIds.push(id);

        // Insert directly via prisma (bypassing repository) with plaintext JSON
        await prisma.modelProvider.create({
          data: {
            id,
            projectId,
            provider: "azure",
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-legacy-key" },
          },
        });

        // Read through repository
        const found = await repository.findByProvider("azure", projectId);

        expect(found).not.toBeNull();
        expect(
          (found!.customKeys as Record<string, unknown>).OPENAI_API_KEY
        ).toBe("sk-legacy-key");
      });
    });
  });

  describe("given a model provider without customKeys", () => {
    describe("when saved and read back", () => {
      it("preserves null customKeys", async () => {
        const created = await repository.create({
          projectId,
          provider: "google",
          enabled: true,
        });
        createdProviderIds.push(created.id);

        const found = await repository.findById(created.id, projectId);

        expect(found).not.toBeNull();
        expect(found!.customKeys).toBeNull();
      });
    });
  });

  describe("given model providers with mixed encrypted and plaintext keys", () => {
    const migrationIds: string[] = [];

    describe("when the migration task runs", () => {
      it("encrypts only the plaintext rows", async () => {
        // 1. Insert plaintext row directly via prisma
        const plaintextId = generate(
          KSUID_RESOURCES.MODEL_PROVIDER
        ).toString();
        migrationIds.push(plaintextId);
        createdProviderIds.push(plaintextId);

        await prisma.modelProvider.create({
          data: {
            id: plaintextId,
            projectId,
            provider: "cohere",
            enabled: true,
            customKeys: { COHERE_API_KEY: "sk-plain" },
          },
        });

        // 2. Insert null row directly via prisma
        const nullId = generate(KSUID_RESOURCES.MODEL_PROVIDER).toString();
        migrationIds.push(nullId);
        createdProviderIds.push(nullId);

        await prisma.modelProvider.create({
          data: {
            id: nullId,
            projectId,
            provider: "mistral",
            enabled: true,
            customKeys: undefined,
          },
        });

        // 3. Save one through repository (will be encrypted)
        const encryptedRow = await repository.create({
          projectId,
          provider: "anthropic",
          enabled: true,
          customKeys: { ANTHROPIC_API_KEY: "sk-ant-already" },
        });
        migrationIds.push(encryptedRow.id);
        createdProviderIds.push(encryptedRow.id);

        // Run migration
        await main();

        // Read all through repository
        const plaintextProvider = await repository.findById(
          plaintextId,
          projectId
        );
        const nullProvider = await repository.findById(nullId, projectId);
        const encryptedProvider = await repository.findById(
          encryptedRow.id,
          projectId
        );

        // Verify plaintext was migrated correctly
        expect(
          (plaintextProvider!.customKeys as Record<string, unknown>)
            .COHERE_API_KEY
        ).toBe("sk-plain");

        // Verify null stayed null
        expect(nullProvider!.customKeys).toBeNull();

        // Verify already-encrypted stayed correct
        expect(
          (encryptedProvider!.customKeys as Record<string, unknown>)
            .ANTHROPIC_API_KEY
        ).toBe("sk-ant-already");

        // Verify raw DB: non-null customKeys are now encrypted strings
        for (const id of migrationIds) {
          const raw = await prisma.modelProvider.findFirst({
            where: { id, projectId },
            select: { customKeys: true },
          });

          if (raw!.customKeys !== null) {
            expect(typeof raw!.customKeys).toBe("string");
            expect((raw!.customKeys as string).split(":")).toHaveLength(3);
          }
        }
      });
    });

    describe("given already-migrated providers", () => {
      describe("when migration runs again", () => {
        it("is idempotent -- skips encrypted rows and data remains valid", async () => {
          // Run migration again (same data from previous test)
          await main();

          // Read through repository -- values still correct
          for (const id of migrationIds) {
            const provider = await repository.findById(id, projectId);
            expect(provider).not.toBeNull();

            if (provider!.customKeys !== null) {
              const keys = provider!.customKeys as Record<string, unknown>;
              // At least one key should have a string value
              const values = Object.values(keys);
              expect(values.length).toBeGreaterThan(0);
              for (const value of values) {
                expect(typeof value).toBe("string");
                expect((value as string).startsWith("sk-")).toBe(true);
              }
            }
          }
        });
      });
    });
  });
});
