/**
 * @vitest-environment node
 *
 * Pull-mode and pure-S3 sources never receive inbound pushes, so the
 * `lw_is_*` ingest secret is dead weight. s3_custom is the exception:
 * it uses the webhook callback path authenticated by ingest secret.
 *
 * This file asserts:
 * 1. createSource for a pull type stores empty sentinel, returns null.
 * 2. createSource for a pure-S3 type (openai_compliance) does the same.
 * 3. createSource for s3_custom (webhook callback) generates a real secret.
 * 4. createSource for a push type generates a real secret.
 * 5. rotateSecret on a non-push source is refused.
 * 6. rotateSecret on a push source still works.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 *       "Pull-source key suppression — #7616"
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({ env: { CREDENTIALS_SECRET: "ab".repeat(32) } }));
vi.mock("~/server/api/enterprise", () => ({ isEnterpriseTier: () => true }));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    commands: { ingestionPull: {} },
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ type: "ENTERPRISE" }),
    },
  }),
}));
vi.mock("@ee/governance/services/pullers/ingestionPullLifecycle", () => ({
  syncIngestionPullSource: vi.fn(),
}));
vi.mock("@ee/governance/services/governanceProject.service", () => ({
  ensureHiddenGovernanceProject: vi.fn(),
}));

import { IngestionSourceService } from "../ingestionSource.service";

function createServiceForCreate() {
  const captured: { data?: Record<string, unknown> } = {};
  const prisma = {
    ingestionSource: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        captured.data = data;
        return Promise.resolve({ id: "src_new", ...data });
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as never;
  return { service: IngestionSourceService.create(prisma), captured };
}

function createServiceForRotate(existing: Record<string, unknown>) {
  const captured: { data?: Record<string, unknown> } = {};
  const prisma = {
    ingestionSource: {
      findFirst: vi.fn().mockResolvedValue(existing),
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockImplementation(({ data }: { data: any }) => {
        captured.data = data;
        return Promise.resolve({ ...existing, ...data });
      }),
    },
  } as never;
  return { service: IngestionSourceService.create(prisma), captured };
}

describe("pull-source key suppression (#7616)", () => {
  /** @scenario "The rotate-secret button is hidden for non-push sources on the list" */
  /** @scenario "The rotate-secret button is hidden for non-push sources on the detail page" */
  describe("when createSource is called", () => {
    it("pull type → empty sentinel hash, null secret", async () => {
      const { service, captured } = createServiceForCreate();

      const result = await service.createSource({
        organizationId: "org_1",
        sourceType: "databricks_genie",
        name: "genie-test",
        pullConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://adb-1.7.azuredatabricks.net",
          spaceIds: [],
          schedule: "*/15 * * * *",
          credentials: { token: "dapi-test-token" },
        },
        pullSchedule: "*/15 * * * *",
        actorUserId: "user_1",
      });

      expect(captured.data?.ingestSecretHash).toBe("");
      expect(result.ingestSecret).toBeNull();
    });

    it("pure-S3 type (openai_compliance) → empty sentinel hash, null secret", async () => {
      const { service, captured } = createServiceForCreate();

      const result = await service.createSource({
        organizationId: "org_1",
        sourceType: "openai_compliance",
        name: "oai-compliance-test",
        pullConfig: {
          adapter: "openai_compliance",
          bucketName: "test-bucket",
          region: "us-east-1",
          prefix: "logs/",
          schedule: "*/30 * * * *",
          credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
        },
        pullSchedule: "*/30 * * * *",
        actorUserId: "user_1",
      });

      expect(captured.data?.ingestSecretHash).toBe("");
      expect(result.ingestSecret).toBeNull();
    });

    it("s3_custom (webhook callback) → real hash and lw_is_ secret", async () => {
      const { service, captured } = createServiceForCreate();

      const result = await service.createSource({
        organizationId: "org_1",
        sourceType: "s3_custom",
        name: "s3-callback-test",
        pullConfig: {
          adapter: "s3_custom",
          bucketName: "test-bucket",
          region: "us-east-1",
          prefix: "logs/",
          schedule: "*/30 * * * *",
          credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
        },
        pullSchedule: "*/30 * * * *",
        actorUserId: "user_1",
      });

      expect(captured.data?.ingestSecretHash).not.toBe("");
      expect(result.ingestSecret).toMatch(/^lw_is_/);
    });

    it("push type → real hash and lw_is_ secret", async () => {
      const { service, captured } = createServiceForCreate();

      const result = await service.createSource({
        organizationId: "org_1",
        sourceType: "otel_generic",
        name: "otel-test",
        actorUserId: "user_1",
      });

      expect(captured.data?.ingestSecretHash).not.toBe("");
      expect(result.ingestSecret).toMatch(/^lw_is_/);
    });
  });

  describe("when rotateSecret is called", () => {
    it("pull-mode source is refused", async () => {
      const { service } = createServiceForRotate({
        id: "src_pull",
        organizationId: "org_1",
        sourceType: "databricks_genie",
        ingestSecretHash: "",
        parserConfig: { adapter: "databricks_genie" },
        pullSchedule: "*/15 * * * *",
      });

      await expect(service.rotateSecret("src_pull", "org_1")).rejects.toThrow();
    });

    it("push-mode source still works", async () => {
      const { service } = createServiceForRotate({
        id: "src_push",
        organizationId: "org_1",
        sourceType: "otel_generic",
        ingestSecretHash: "existing-hash-abc",
        parserConfig: {},
        pullSchedule: null,
      });

      const { ingestSecret } = await service.rotateSecret("src_push", "org_1");
      expect(ingestSecret).toMatch(/^lw_is_/);
    });
  });
});
