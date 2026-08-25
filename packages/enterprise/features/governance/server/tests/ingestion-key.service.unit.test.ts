import { describe, expect, it, vi } from "vitest";
import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
} from "../src/ports/ingestion-source-key.port";
import { OrganizationService } from "@langwatch/organization-contract";
import { IngestionKeyService } from "../src/services/ingestion-source-key.service";

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

class FakeOrganizations extends OrganizationService {
  projectId: string | null = "project-personal";
  getOldestTeamId = unsupported<OrganizationService["getOldestTeamId"]>();
  getBillingProfile = unsupported<OrganizationService["getBillingProfile"]>();
  claimBillingCustomerId =
    unsupported<OrganizationService["claimBillingCustomerId"]>();
  ensurePersonalWorkspace =
    unsupported<OrganizationService["ensurePersonalWorkspace"]>();
  getPersonalWorkspaceFeatures =
    unsupported<OrganizationService["getPersonalWorkspaceFeatures"]>();
  enableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["enableAllPersonalWorkspaceFeatures"]>();
  disableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["disableAllPersonalWorkspaceFeatures"]>();
  getTeam = unsupported<OrganizationService["getTeam"]>();
  listTeams = unsupported<OrganizationService["listTeams"]>();
  createTeam = unsupported<OrganizationService["createTeam"]>();
  updateTeam = unsupported<OrganizationService["updateTeam"]>();
  archiveTeam = unsupported<OrganizationService["archiveTeam"]>();
  addTeamMember = unsupported<OrganizationService["addTeamMember"]>();
  removeTeamMember = unsupported<OrganizationService["removeTeamMember"]>();

  async tryFindPersonalWorkspace(): Promise<
    Awaited<ReturnType<OrganizationService["tryFindPersonalWorkspace"]>>
  > {
    return this.projectId
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
}

function unsupported<Method>(): Method {
  return (() => Promise.reject(new Error("not used by this test"))) as Method;
}

describe("IngestionKeyService", () => {
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
