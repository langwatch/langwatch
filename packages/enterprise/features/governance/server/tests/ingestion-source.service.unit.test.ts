import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { GovernanceDiagnosticsPort } from "../src/ports/governance-diagnostics.port";
import {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
  IngestionSourceRepository,
  type CreateIngestionSourceRecord,
  type UpdateIngestionSourceRecord,
} from "../src/ports/ingestion-source.port";
import { GovernanceEncryptionPort } from "../src/ports/governance-encryption.port";
import { IngestionCredentialsService } from "../src/services/ingestion-credentials.service";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../src/services/ingestion-source-secret.service";
import { IngestionSourceService } from "../src/services/ingestion-source.service";
import { PullDestinationService } from "../src/services/pull-destination.service";
import { TestProjectService } from "./support/test-project-service";

const NOW = Date.parse("2026-08-24T10:00:00.000Z");

function source(
  overrides: Partial<GovernanceIngestionSource> = {},
): GovernanceIngestionSource {
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
}

class FakeProjects extends TestProjectService {
  tryFindInternal = vi.fn(
    async (_input: InternalProjectQuery): Promise<InternalProject | null> => null,
  );
  ensureInternal = vi.fn(
    async (_input: InternalProjectQuery): Promise<InternalProject> => ({
      id: "gov-project",
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
    }),
  );
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
  const service = IngestionSourceService.create({
    repository,
    projects: new FakeProjects(),
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
  return { service, repository, entitlements, lifecycle };
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
});
