import {
  AuthzService as AuthzServiceContract,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { AuthzService } from "../src/services/authz.service";
import { StubAuthzListingRepository } from "./support/authz-listing.stub";
import { makeReader } from "./support/authz-read.stub";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "project-1";

function makeService({
  listing = new StubAuthzListingRepository(),
  reader = makeReader(),
} = {}) {
  return {
    listing,
    service: AuthzService.create({ repository: reader, listing }),
  };
}

describe("AuthzService portable facade", () => {
  it("is the concrete implementation of the portable capability", () => {
    expect(makeService().service).toBeInstanceOf(AuthzServiceContract);
  });

  it("routes declared and imperative checks through the same decision engine", async () => {
    const { service } = makeService({
      reader: makeReader({
        tryFindOrganizationRole: vi.fn().mockResolvedValue("ADMIN"),
      }),
    });

    await expect(
      service.getDecision({
        userId: "admin-1",
        permission: "organization:view",
        scope: { tier: "organization", id: ORG },
      }),
    ).resolves.toEqual({ permitted: true, organizationRole: "ADMIN" });

    const witness = await service.authorizePermission({
      userId: "admin-1",
      permission: "organization:view",
      organizationId: ORG,
    });
    expect(witness).toMatchObject({
      permission: "organization:view",
      scope: { tier: "organization", id: ORG },
    });
  });

  it("throws the portable denial when authorization fails", async () => {
    const { service } = makeService();

    await expect(
      service.authorize({
        principal: { type: "user", id: "user-1" },
        permission: "organization:manage",
        scope: { type: "organization", id: ORG },
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("fences project API-key checks to the resolved organization", async () => {
    const { service } = makeService({
      reader: makeReader({
        tryFindProjectLineage: vi.fn().mockResolvedValue({
          teamId: TEAM,
          organizationId: ORG,
        }),
        tryFindApiKeyOwner: vi.fn().mockResolvedValue({ userId: null }),
        findApiKeyBindings: vi.fn().mockResolvedValue([
          {
            role: "ADMIN",
            customRoleId: null,
            scopeType: "PROJECT",
            scopeId: PROJECT,
            viaGroupId: null,
          },
        ]),
      }),
    });

    await expect(
      service.getApiKeyProjectDecision({
        apiKeyId: "key-1",
        userId: null,
        organizationId: "another-org",
        projectId: PROJECT,
        permission: "datasets:manage",
      }),
    ).resolves.toEqual({ outcome: "project_not_found" });

    await expect(
      service.getApiKeyProjectDecision({
        apiKeyId: "key-1",
        userId: null,
        organizationId: ORG,
        projectId: PROJECT,
        permission: "datasets:manage",
      }),
    ).resolves.toEqual({
      outcome: "allowed",
      scope: { projectId: PROJECT, teamId: TEAM, organizationId: ORG },
    });
  });

  it("keeps access-list persistence behind the service", async () => {
    const { service, listing } = makeService();

    await expect(
      service.listOrganizationBindings({ organizationId: ORG }),
    ).resolves.toEqual([]);
    expect(listing.findOrganizationBindings).toHaveBeenCalledWith({
      organizationId: ORG,
    });
  });
});
