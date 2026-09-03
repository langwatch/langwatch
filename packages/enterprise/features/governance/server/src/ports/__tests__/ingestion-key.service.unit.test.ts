import { describe, expect, it, vi } from "vitest";
import type { OrganizationService } from "@langwatch/organization-contract";
import { IngestionKeyIssuerPort, IngestionKeyRepository } from "../ingestion-source-key.port";
import { IngestionKeyService } from "../../services/ingestion-source-key.service";
import { TestOrganizationService } from "./support/test-organization-service";

class FakeIngestionKeyRepository extends IngestionKeyRepository {
  prior: Awaited<ReturnType<IngestionKeyRepository["tryFindIngestKey"]>> = null;
  tryFindIngestKey = vi.fn(async () => this.prior);
  findIngestKeysForProject = vi.fn(async () => []);
}

class FakeIngestionKeyIssuer extends IngestionKeyIssuerPort {
  readonly calls: string[] = [];
  create = vi.fn(async () => {
    this.calls.push("create");
    return { token: "ik-lw-plain-token", apiKey: { id: "key-new" } };
  });
  revoke = vi.fn(async () => {
    this.calls.push("revoke");
  });
}

class FakeOrganizations extends TestOrganizationService {
  projectId: string | null = "project-personal";

  tryFindPersonalWorkspace = async (): Promise<
    Awaited<ReturnType<OrganizationService["tryFindPersonalWorkspace"]>>
  > =>
    this.projectId
      ? {
          team: { id: "team", name: "Mine", slug: "mine", createdAtMs: 1 },
          project: {
            id: this.projectId,
            name: "Personal",
            slug: "personal",
            apiKey: "pkey",
            createdAtMs: 1,
          },
        }
      : null;
}

describe("IngestionKeyService", () => {
  /**
   * The hard-cut rotation's latency contract: one request, one projection
   * hold. The revoke of the prior key rides the same per-organization FIFO
   * ledger queue as the mint that follows, so only the mint's final grant
   * attach needs to hold for the projection.
   *
   * Feature: specs/api-keys/ingest-key-rotation-latency.feature
   * @scenario "Rotating a key answers without waiting on the old key's cleanup"
   */
  it("hard-revokes the prior key before minting its replacement", async () => {
    const repository = new FakeIngestionKeyRepository();
    repository.prior = {
      id: "key-old",
      lookupId: "lookup-old",
      ingestSourceType: "claude_code",
      ingestionTemplateId: null,
    };
    const issuer = new FakeIngestionKeyIssuer();
    const service = IngestionKeyService.create({
      repository,
      issuer,
      organizations: new FakeOrganizations(),
    });

    const result = await service.ensureForProject({
      callerUserId: "caller-1",
      ownerUserId: "owner-1",
      organizationId: "org-1",
      projectId: "project-1",
      sourceType: "claude_code",
    });

    expect(issuer.calls).toEqual(["revoke", "create"]);
    expect(issuer.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: "key-old", awaitProjection: false }),
    );
    expect(result).toEqual({
      token: "ik-lw-plain-token",
      apiKeyId: "key-new",
      prefix: "ik-lw-plain-",
      sourceType: "claude_code",
    });
  });

  it("mints without revoking anything when no prior key exists", async () => {
    const repository = new FakeIngestionKeyRepository();
    repository.prior = null;
    const issuer = new FakeIngestionKeyIssuer();
    const service = IngestionKeyService.create({
      repository,
      issuer,
      organizations: new FakeOrganizations(),
    });

    const issued = await service.ensureForProject({
      callerUserId: "caller-1",
      ownerUserId: "owner-1",
      organizationId: "org-1",
      projectId: "project-1",
      sourceType: "claude_code",
    });

    expect(issuer.revoke).not.toHaveBeenCalled();
    expect(issued.apiKeyId).toBe("key-new");
  });

  it("does not revoke another machine's key for additive issue", async () => {
    const repository = new FakeIngestionKeyRepository();
    repository.prior = {
      id: "key-old",
      lookupId: "lookup-old",
      ingestSourceType: "claude_code",
      ingestionTemplateId: null,
    };
    const issuer = new FakeIngestionKeyIssuer();
    const service = IngestionKeyService.create({
      repository,
      issuer,
      organizations: new FakeOrganizations(),
    });

    await service.issueForProject({
      callerUserId: "caller-1",
      ownerUserId: "owner-1",
      organizationId: "org-1",
      projectId: "project-1",
      sourceType: "claude_code",
      createdByDeviceLabel: "laptop",
    });

    expect(issuer.revoke).not.toHaveBeenCalled();
    expect(issuer.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ingestion key (claude_code, laptop)" }),
    );
  });
});
