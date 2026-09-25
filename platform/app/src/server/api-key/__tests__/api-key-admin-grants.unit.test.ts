import { describe, expect, it, vi } from "vitest";
import {
  credentialFixture,
  grant,
  KEY,
  ORG,
  USER,
} from "~/server/app-layer/authz/__tests__/credential-permissions.fixture";
import { ApiKeyRepository } from "../api-key.repository";
import { ApiKeyService } from "../api-key.service";

vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ({}),
}));

describe("API key administrator identity", () => {
  it("refuses API key operations after the caller's organization seat is disabled", async () => {
    const fixture = credentialFixture();
    const service = ApiKeyService.create(fixture.prisma);
    const query = { organizationId: ORG, userId: USER };
    await expect(
      service.ensureCallerIsOrgMember(query),
    ).resolves.toBeUndefined();

    fixture.memberships.set(USER, { role: "MEMBER", disabledAt: new Date() });
    await expect(service.ensureCallerIsOrgMember(query)).rejects.toThrow(
      "Not a member of this organization",
    );
  });

  it("requires a live organization admin grant and an active member", async () => {
    const fixture = credentialFixture();
    const repository = ApiKeyRepository.create(fixture.prisma);
    const query = { organizationId: ORG, userId: USER };
    expect(await repository.findOrgAdminBinding(query)).toBeNull();
    const binding = grant({
      roleKey: "admin",
      scopeType: "ORGANIZATION",
      scopeId: ORG,
    });
    fixture.grants.push(binding);
    expect(await repository.findOrgAdminBinding(query)).toEqual({
      userId: USER,
    });
    binding.revokedAt = new Date();
    expect(await repository.findOrgAdminBinding(query)).toBeNull();
    binding.revokedAt = null;
    fixture.memberships.set(USER, { role: "EXTERNAL", disabledAt: null });
    expect(await repository.findOrgAdminBinding(query)).toBeNull();
    fixture.memberships.delete(USER);
    expect(await repository.findOrgAdminBinding(query)).toBeNull();
    expect(fixture.legacyRead).not.toHaveBeenCalled();
  });

  it("requires the exact key's organization admin grant", async () => {
    const fixture = credentialFixture();
    const repository = ApiKeyRepository.create(fixture.prisma);
    const query = { organizationId: ORG, apiKeyId: KEY };
    const binding = grant({
      principalType: "API_KEY",
      principalId: "other-key",
      roleKey: "admin",
      scopeType: "ORGANIZATION",
      scopeId: ORG,
    });
    fixture.grants.push(binding);
    expect(await repository.findOrgAdminApiKeyBinding(query)).toBeNull();
    binding.principalId = KEY;
    expect(await repository.findOrgAdminApiKeyBinding(query)).toEqual({
      apiKeyId: KEY,
    });
    binding.revokedAt = new Date();
    expect(await repository.findOrgAdminApiKeyBinding(query)).toBeNull();
  });
});
