import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { GovernanceDiagnosticsPort } from "../governance-diagnostics.port";
import {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
  IngestionSourceRepository,
  type CreateIngestionSourceRecord,
  type UpdateIngestionSourceRecord,
} from "../ingestion-source.port";
import { GovernanceEncryptionPort } from "../governance-encryption.port";
import { IngestionCredentialsService } from "../../services/ingestion-credentials.service";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../../services/ingestion-source-secret.service";
import { IngestionSourceService } from "../../services/ingestion-source.service";
import { PullDestinationService } from "../../services/pull-destination.service";
import { TestProjectService } from "./support/test-project-service";

const NOW = Date.parse("2026-08-24T10:00:00.000Z");

function source(overrides: Partial<GovernanceIngestionSource> = {}): GovernanceIngestionSource {
  return {
    id: "source-1",
    organizationId: "org-1",
    teamId: null,
    sourceType: "otel_generic",
    name: "OTel",
    description: null,
    ingestSecretHash: "old-hash",
    parserConfig: {},
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: null,
    status: "awaiting_first_event",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    createdById: "user-1",
    ...overrides,
  };
}

class FakeSourceRepository extends IngestionSourceRepository {
  row: GovernanceIngestionSource = source();
  createInput: CreateIngestionSourceRecord | null = null;
  updateInput: UpdateIngestionSourceRecord | null = null;
  list = vi.fn(async () => [this.row]);
  tryFindById = vi.fn(async () => this.row);
  tryFindByCurrentSecretHash = vi.fn(async () => null);
  findByPriorSecretHash = vi.fn(async () => []);
  countLive = vi.fn(async () => 0);
  create = vi.fn(async (input: CreateIngestionSourceRecord) => {
    this.createInput = input;
    this.row = source({ ...input });
    return this.row;
  });
  update = vi.fn(async (_id: string, input: UpdateIngestionSourceRecord) => {
    this.updateInput = input;
    this.row = source({ ...this.row, ...input });
    return this.row;
  });
  tryUpdateIfCursorUnchanged = vi.fn(
    async (input: {
      update: UpdateIngestionSourceRecord;
    }): Promise<GovernanceIngestionSource | null> => {
      this.updateInput = input.update;
      this.row = source({ ...this.row, ...input.update });
      return this.row;
    },
  );
}

class FakeProjects extends TestProjectService {
  tryFindInternal = vi.fn(
    async (_input: InternalProjectQuery): Promise<InternalProject | null> => null,
  );
  ensureInternal = vi.fn(async (_input: InternalProjectQuery): Promise<InternalProject> => ({
    id: "gov-project",
    name: "Governance (internal)",
    slug: "governance-org",
    teamId: "team",
    kind: "internal_governance",
    archivedAtMs: null,
    traceSharingEnabled: false,
  }));
  tryGetWithTeam = vi.fn(async () => null);
}
class FakeEntitlements extends IngestionSourceEntitlementsPort {
  enterprise = true;
  async hasEnterprisePlan(): Promise<boolean> {
    return this.enterprise;
  }
}
class FakeLifecycle extends IngestionSourceLifecyclePort {
  sync = vi.fn(async () => undefined);
}
class FakeEncryption extends GovernanceEncryptionPort {
  encrypt(value: string): string {
    return Buffer.from(value).toString("base64url");
  }
  decrypt(value: string): string {
    return Buffer.from(value, "base64url").toString();
  }
}
class FakeDiagnostics extends GovernanceDiagnosticsPort {
  warn = vi.fn();
}

function harness() {
  const repository = new FakeSourceRepository();
  const entitlements = new FakeEntitlements();
  const lifecycle = new FakeLifecycle();
  const projects = new FakeProjects();
  const service = IngestionSourceService.create({
    repository,
    projects,
    entitlements,
    lifecycle,
    credentials: IngestionCredentialsService.create(new FakeEncryption()),
    secrets: IngestionSecretService.create(
      IngestionSecretConfiguration.create({ pepper: "pepper" }),
      { random: () => new Uint8Array(32).fill(7) },
    ),
    destinations: PullDestinationService.create(),
    diagnostics: new FakeDiagnostics(),
    now: () => NOW,
  });
  return { service, repository, projects, entitlements, lifecycle };
}

describe("IngestionSourceService", () => {
  it("encrypts credentials before persistence and returns a one-time secret", async () => {
    const { service, repository } = harness();
    const result = await service.createSource({
      organizationId: "org-1",
      sourceType: "otel_generic",
      name: "OTel",
      actorUserId: "user-1",
      parserConfig: { credentials: { token: "secret" } },
    });

    expect(result.ingestSecret).toMatch(/^lw_is_/);
    expect(repository.createInput?.parserConfig.credentials).toEqual(
      expect.stringMatching(/^enc:v1:/),
    );
    expect(repository.createInput?.parserConfig).not.toEqual(
      expect.objectContaining({ credentials: { token: "secret" } }),
    );
  });

  /** @scenario "Saving without touching the secret keeps the existing credential" */
  it("preserves stored credentials and rotation metadata on ordinary edits", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: {
        credentials: "enc:v1:c2VjcmV0",
        _rotation: { priorHash: "old", expiresAt: NOW + 1_000 },
        visible: "old",
      },
    });

    await service.updateSource({
      id: "source-1",
      organizationId: "org-1",
      parserConfig: { visible: "new" },
    });

    expect(repository.updateInput?.parserConfig).toMatchObject({
      credentials: "enc:v1:c2VjcmV0",
      _rotation: { priorHash: "old", expiresAt: NOW + 1_000 },
      visible: "new",
    });
  });

  /** @scenario "Entering a new secret replaces the stored one" */
  it("encrypts a freshly typed credential on the edit path, not only on create", async () => {
    const { service, repository } = harness();
    repository.row = source({ parserConfig: { credentials: "enc:v1:c2VjcmV0" } });

    await service.updateSource({
      id: "source-1",
      organizationId: "org-1",
      parserConfig: { credentials: { token: "sk-ant-admin-new" } },
    });

    expect(repository.updateInput?.parserConfig?.credentials).toEqual(
      expect.stringMatching(/^enc:v1:/),
    );
    expect(repository.updateInput?.parserConfig).not.toEqual(
      expect.objectContaining({ credentials: { token: "sk-ant-admin-new" } }),
    );
  });

  /** @scenario "A stored envelope is never sent back to the server" */
  it("refuses a stored encrypted credential replay before changing the source", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: {
        credentials: "enc:v1:c2VjcmV0",
        workspaceUrl: "https://safe.example.test",
      },
    });

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        parserConfig: {
          credentials: "enc:v1:c2VjcmV0",
          workspaceUrl: "https://attacker.example.test",
        },
      }),
    ).rejects.toThrow("Credentials cannot be submitted in their stored form");
    expect(repository.updateInput).toBeNull();
  });

  it("keeps the stored adapter and refuses attempts to replace it", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: {
        adapter: "databricks_genie",
        workspaceUrl: "https://safe.cloud.databricks.com",
      },
    });

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        parserConfig: {
          adapter: "http_polling",
          url: "https://attacker.example.test",
        },
      }),
    ).rejects.toThrow(/fixed when the source is created/);
    expect(repository.updateInput).toBeNull();
  });

  /** @scenario "Saving an unrelated change keeps the secret and the rotation window" */
  it("keeps the stored secret and the rotation grace slot on an unrelated edit", async () => {
    const { service, repository } = harness();
    const rotation = { priorHash: "abc123", expiresAt: NOW + 1_000 };
    repository.row = source({
      parserConfig: {
        adapter: "databricks_genie",
        workspaceUrl: "https://adb-1.7.azuredatabricks.net",
        credentials: "enc:v1:aaaa:bbbb:cccc",
        _rotation: rotation,
      },
    });

    await service.updateSource({
      id: "source-1",
      organizationId: "org-1",
      name: "renamed",
      parserConfig: {
        adapter: "databricks_genie",
        workspaceUrl: "https://adb-1.7.azuredatabricks.net",
      },
    });

    expect(repository.updateInput?.parserConfig).toMatchObject({
      credentials: "enc:v1:aaaa:bbbb:cccc",
      _rotation: rotation,
    });
  });

  /** @scenario "A secret cannot be kept while the destination is changed" */
  it("refuses replaying the stored secret while also changing the destination, writing nothing", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: {
        adapter: "databricks_genie",
        workspaceUrl: "https://adb-1.7.azuredatabricks.net",
        credentials: "enc:v1:aaaa:bbbb:cccc",
      },
    });

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://attacker.example.com",
          credentials: "enc:v1:aaaa:bbbb:cccc",
        },
      }),
    ).rejects.toThrow(/stored form/);
    expect(repository.updateInput).toBeNull();
  });

  /** @scenario "The report cannot be changed once a cursor exists" */
  it("refuses a report change after the source has pulled", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: { adapter: "anthropic_admin", report: "usage" },
      pollerCursor: "page-2",
    });

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        parserConfig: { report: "cost" },
      }),
    ).rejects.toThrow(/already pulled its usage report/);
    expect(repository.updateInput).toBeNull();
  });

  /** @scenario "A source that starts pulling mid-save does not lose the rule" */
  it("atomically pins a report change before the first pull", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: { adapter: "anthropic_admin", report: "usage" },
      pollerCursor: null,
    });

    await service.updateSource({
      id: "source-1",
      organizationId: "org-1",
      parserConfig: { report: "cost" },
    });

    expect(repository.tryUpdateIfCursorUnchanged).toHaveBeenCalledWith({
      id: "source-1",
      cursor: null,
      update: expect.objectContaining({
        parserConfig: expect.objectContaining({ report: "cost" }),
      }),
    });
  });

  /** @scenario "A source that starts pulling mid-save does not lose the rule" */
  it("refuses a report update when a pull wins the race", async () => {
    const { service, repository } = harness();
    repository.row = source({
      parserConfig: { adapter: "anthropic_admin", report: "usage" },
      pollerCursor: null,
    });
    repository.tryUpdateIfCursorUnchanged.mockResolvedValueOnce(null);

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        parserConfig: { report: "cost" },
      }),
    ).rejects.toThrow(/started pulling while the change was being saved/);
  });

  it("refuses a foreign or archived trace destination before creating the source", async () => {
    const { service, repository, projects } = harness();

    await expect(
      service.createSource({
        organizationId: "org-1",
        sourceType: "otel_generic",
        name: "OTel",
        actorUserId: "user-1",
        traceProjectId: "project-outside-org",
      }),
    ).rejects.toThrow(/destination must be an active project/i);
    expect(projects.tryGetWithTeam).toHaveBeenCalledWith("project-outside-org");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("refuses a foreign or archived trace destination before updating the source", async () => {
    const { service, repository } = harness();

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        traceProjectId: "project-outside-org",
      }),
    ).rejects.toThrow(/destination must be an active project/i);
    expect(repository.update).not.toHaveBeenCalled();
  });

  /**
   * The picker only ever offers projects of the admin's own organization, but
   * the picker is not the boundary — the API is. A destination reaching
   * update by any other route (a crafted request, a stale drawer, a script)
   * has to be refused here, and refused by name so the admin knows which
   * field is wrong rather than being handed a generic failure.
   *
   * @scenario The picker cannot offer a project of another organization
   */
  it("is refused when the fetched project belongs to a different organization", async () => {
    const { service, repository, projects } = harness();
    projects.tryGetWithTeam = vi.fn(async () => ({
      id: "project-of-another-org",
      name: "Someone else's project",
      slug: "someone-elses-project",
      archivedAt: null,
      team: { organizationId: "org-other" },
    })) as never;

    await expect(
      service.updateSource({
        id: "source-1",
        organizationId: "org-1",
        traceProjectId: "project-of-another-org",
      }),
    ).rejects.toThrow(/destination must be an active project/i);
    expect(repository.update).not.toHaveBeenCalled();
  });

  /**
   * Pull-mode and pure-S3 sources never receive inbound pushes, so the
   * `lw_is_*` ingest secret is dead weight. s3_custom is the exception: it
   * uses the webhook callback path authenticated by ingest secret.
   *
   * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
   *       "Pull-source key suppression — #7616"
   */
  describe("pull-source key suppression (#7616)", () => {
    describe("when createSource is called", () => {
      /** @scenario "The rotate-secret button is hidden for non-push sources on the list" */
      /** @scenario "The rotate-secret button is hidden for non-push sources on the detail page" */
      it("pull type → empty sentinel hash, null secret", async () => {
        const { service, repository } = harness();

        const result = await service.createSource({
          organizationId: "org-1",
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
          actorUserId: "user-1",
        });

        expect(repository.createInput?.ingestSecretHash).toBe("");
        expect(result.ingestSecret).toBeNull();
      });

      it("pure-S3 type (openai_compliance) → empty sentinel hash, null secret", async () => {
        const { service, repository } = harness();

        const result = await service.createSource({
          organizationId: "org-1",
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
          actorUserId: "user-1",
        });

        expect(repository.createInput?.ingestSecretHash).toBe("");
        expect(result.ingestSecret).toBeNull();
      });

      it("s3_custom (webhook callback) → real hash and lw_is_ secret", async () => {
        const { service, repository } = harness();

        const result = await service.createSource({
          organizationId: "org-1",
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
          actorUserId: "user-1",
        });

        expect(repository.createInput?.ingestSecretHash).not.toBe("");
        expect(result.ingestSecret).toMatch(/^lw_is_/);
      });

      it("push type → real hash and lw_is_ secret", async () => {
        const { service, repository } = harness();

        const result = await service.createSource({
          organizationId: "org-1",
          sourceType: "otel_generic",
          name: "otel-test",
          actorUserId: "user-1",
        });

        expect(repository.createInput?.ingestSecretHash).not.toBe("");
        expect(result.ingestSecret).toMatch(/^lw_is_/);
      });
    });

    describe("when rotateSecret is called", () => {
      it("pull-mode source is refused", async () => {
        const { service, repository } = harness();
        repository.row = source({
          id: "src_pull",
          organizationId: "org-1",
          sourceType: "databricks_genie",
          ingestSecretHash: "",
          parserConfig: { adapter: "databricks_genie" },
          pullSchedule: "*/15 * * * *",
        });

        await expect(
          service.rotateSecret({ id: "src_pull", organizationId: "org-1" }),
        ).rejects.toThrow();
      });

      it("push-mode source still works", async () => {
        const { service, repository } = harness();
        repository.row = source({
          id: "src_push",
          organizationId: "org-1",
          sourceType: "otel_generic",
          ingestSecretHash: "existing-hash-abc",
          parserConfig: {},
          pullSchedule: null,
        });

        const { ingestSecret } = await service.rotateSecret({
          id: "src_push",
          organizationId: "org-1",
        });
        expect(ingestSecret).toMatch(/^lw_is_/);
      });
    });
  });

  describe("given a destination on a team this admin is not a member of", () => {
    describe("when the drawer asks which destinations are still live", () => {
      /**
       * The drawer says an unresolvable destination is archived, and the spec
       * promises the reverse case is never mislabelled: a project the admin
       * simply cannot see is not gone. That promise rests entirely on this
       * query scoping liveness to the ORGANIZATION rather than to the
       * reader's team memberships — narrow it to the reader and every
       * cross-team destination starts reporting as archived, sending admins
       * to restore projects that were never archived.
       */
      it("scopes liveness to the organization, not to what this admin can see", async () => {
        const { service, projects } = harness();
        projects.listActiveByScopes = vi.fn(async () => ({
          data: [{ id: "proj_other_team" }],
          hasMore: false,
        })) as never;

        const live = await service.liveTraceProjectIds(
          [{ traceProjectId: "proj_other_team" }],
          "org-1",
        );

        expect(live.has("proj_other_team")).toBe(true);
        expect(projects.listActiveByScopes).toHaveBeenCalledWith({
          organizationId: "org-1",
          organizationWide: false,
          teamIds: [],
          projectIds: ["proj_other_team"],
          limit: 1,
        });
      });
    });
  });
});
