import type { AuthzPermission } from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import {
  checkPrincipalPermission,
  resolveApiKeyPermission,
  resolveApiKeyPermissionProjectBatch,
} from "../credential-permissions";
import {
  credentialFixture,
  GROUP,
  grant,
  KEY,
  ORG,
  PROJECT,
  role,
  TEAM,
  USER,
} from "./credential-permissions.fixture";

const scope = { type: "project", id: PROJECT, teamId: TEAM } as const;
const check = (
  fixture: ReturnType<typeof credentialFixture>,
  permission: AuthzPermission,
) =>
  checkPrincipalPermission({
    prisma: fixture.prisma,
    userId: USER,
    organizationId: ORG,
    scope,
    permission,
  });
const keyCheck = (
  fixture: ReturnType<typeof credentialFixture>,
  permission: AuthzPermission,
) =>
  resolveApiKeyPermission({
    prisma: fixture.prisma,
    apiKeyId: KEY,
    userId: USER,
    organizationId: ORG,
    scope,
    permission,
  });

describe("credential grant decisions", () => {
  /** @scenario Effective role maps to correct permission grants */
  it.each([
    { roleKey: "admin", permission: "team:manage", allowed: true },
    { roleKey: "member", permission: "team:manage", allowed: false },
    { roleKey: "viewer", permission: "analytics:view", allowed: true },
    { roleKey: "viewer", permission: "datasets:manage", allowed: false },
  ] satisfies Array<{
    roleKey: string;
    permission: AuthzPermission;
    allowed: boolean;
  }>)("$roleKey decides $permission as $allowed", async ({
    roleKey,
    permission,
    allowed,
  }) => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ roleKey }));
    expect(await check(fixture, permission)).toBe(allowed);
    expect(fixture.legacyRead).not.toHaveBeenCalled();
    expect(fixture.migrationRead).not.toHaveBeenCalled();
  });

  it("unions ancestor grants without granting from unrelated scopes", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ roleKey: "viewer", scopeType: "PROJECT", scopeId: PROJECT }),
    );
    expect(await check(fixture, "datasets:manage")).toBe(false);
    fixture.grants.push(grant({ roleKey: "admin", scopeId: "other-team" }));
    expect(await check(fixture, "datasets:manage")).toBe(false);
    fixture.grants.push(grant({ roleKey: "member" }));
    expect(await check(fixture, "datasets:manage")).toBe(true);
  });

  it("uses explicit custom permissions without adding a viewer baseline", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ roleKey: "custom:role-credential" }));
    fixture.roles.push(role({ permissions: ["datasets:manage"] }));
    expect(await check(fixture, "datasets:manage")).toBe(true);
    expect(await check(fixture, "traces:view")).toBe(false);
    fixture.roles[0] = role({ permissions: [] });
    expect(await check(fixture, "traces:view")).toBe(false);
    fixture.roles.length = 0;
    expect(await check(fixture, "traces:view")).toBe(false);
  });

  it("refuses org-exclusive permissions from team or project grants", async () => {
    const fixture = credentialFixture();
    fixture.roles.push(
      role({ permissions: ["governance:manage", "project:manage"] }),
    );
    const binding = grant({ roleKey: "custom:role-credential" });
    fixture.grants.push(binding);
    expect(await check(fixture, "governance:manage")).toBe(false);
    expect(await check(fixture, "project:manage")).toBe(true);
    binding.scopeType = "PROJECT";
    binding.scopeId = PROJECT;
    expect(await check(fixture, "governance:manage")).toBe(false);
    binding.scopeType = "ORGANIZATION";
    binding.scopeId = ORG;
    expect(await check(fixture, "governance:manage")).toBe(true);
  });

  /** @scenario A poisoned cross-organization binding does not grant access */
  it("rejects foreign, private, and deleted custom roles", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ roleKey: "custom:role-credential" }));
    for (const invalid of [
      role({ organizationId: "other-org" }),
      role({ kind: "system_api_key" }),
      role({ deletedAt: new Date() }),
    ]) {
      fixture.roles[0] = invalid;
      expect(await check(fixture, "traces:view")).toBe(false);
    }
    fixture.roles[0] = role();
    expect(await check(fixture, "traces:view")).toBe(true);
  });

  it("denies removed and disabled members even with direct and group grants", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant(),
      grant({ principalType: "GROUP", principalId: GROUP }),
    );
    fixture.groups.push({ userId: USER, groupId: GROUP, organizationId: ORG });
    expect(await check(fixture, "traces:view")).toBe(true);
    fixture.memberships.set(USER, { role: "MEMBER", disabledAt: new Date() });
    expect(await check(fixture, "traces:view")).toBe(false);
    fixture.memberships.delete(USER);
    expect(await check(fixture, "traces:view")).toBe(false);
  });

  it("denies empty grants without consulting legacy rows or migration state", async () => {
    const fixture = credentialFixture();
    expect(await check(fixture, "traces:view")).toBe(false);
    expect(fixture.legacyRead).not.toHaveBeenCalled();
    expect(fixture.migrationRead).not.toHaveBeenCalled();
  });

  it("refuses a missing principal and can inspect a key's own grant", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ principalType: "API_KEY", principalId: KEY }));
    expect(
      await checkPrincipalPermission({
        prisma: fixture.prisma,
        organizationId: ORG,
        scope,
        permission: "traces:view",
      }),
    ).toBe(false);
    expect(
      await checkPrincipalPermission({
        prisma: fixture.prisma,
        principal: { type: "apiKey", id: KEY },
        organizationId: ORG,
        scope,
        permission: "traces:view",
      }),
    ).toBe(true);
    expect(await keyCheck(fixture, "traces:view")).toBe(false);
  });

  it("stops honoring a revoked grant on the next decision", async () => {
    const fixture = credentialFixture();
    const binding = grant();
    fixture.grants.push(binding);
    expect(await check(fixture, "traces:view")).toBe(true);
    binding.revokedAt = new Date();
    expect(await check(fixture, "traces:view")).toBe(false);
  });
});

describe("API key owner ceiling", () => {
  it.each([
    { key: true, owner: true, allowed: true },
    { key: true, owner: false, allowed: false },
    { key: false, owner: true, allowed: false },
    { key: false, owner: false, allowed: false },
  ])("intersects key=$key with owner=$owner", async ({
    key,
    owner,
    allowed,
  }) => {
    const fixture = credentialFixture();
    if (key)
      fixture.grants.push(
        grant({ principalType: "API_KEY", principalId: KEY }),
      );
    if (owner) fixture.grants.push(grant());
    expect(await keyCheck(fixture, "project:update")).toBe(allowed);
  });

  /** @scenario "An API key's ceiling cannot be dropped by its caller" */
  it("uses the stored owner and honors its latest grants", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ principalType: "API_KEY", principalId: KEY }));
    const owner = grant();
    fixture.grants.push(owner);
    expect(await keyCheck(fixture, "project:update")).toBe(true);
    owner.roleKey = "viewer";
    expect(await keyCheck(fixture, "project:update")).toBe(false);
    expect(await keyCheck(fixture, "project:view")).toBe(true);
    fixture.key.userId = "different-owner";
    expect(await keyCheck(fixture, "project:view")).toBe(false);
    expect(
      await resolveApiKeyPermission({
        prisma: fixture.prisma,
        apiKeyId: KEY,
        userId: null,
        organizationId: ORG,
        scope,
        permission: "project:view",
      }),
    ).toBe(false);
    fixture.key.userId = null;
    expect(await keyCheck(fixture, "project:update")).toBe(true);
  });

  it("accepts an owner's group grant only while both memberships remain", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ principalType: "API_KEY", principalId: KEY }),
      grant({ principalType: "GROUP", principalId: GROUP }),
    );
    fixture.groups.push({ userId: USER, groupId: GROUP, organizationId: ORG });
    expect(await keyCheck(fixture, "project:update")).toBe(true);
    fixture.groups.length = 0;
    expect(await keyCheck(fixture, "project:update")).toBe(false);
  });

  /** @scenario A poisoned cross-key binding does not inherit the other key's permissions */
  it("restricts a private system role to the sole key holding it", async () => {
    const fixture = credentialFixture();
    fixture.key.userId = null;
    fixture.roles.push(role({ kind: "system_api_key" }));
    fixture.grants.push(
      grant({
        principalType: "API_KEY",
        principalId: KEY,
        roleKey: "custom:role-credential",
      }),
    );
    expect(await keyCheck(fixture, "traces:view")).toBe(true);
    fixture.grants.push(grant({ roleKey: "custom:role-credential" }));
    expect(await keyCheck(fixture, "traces:view")).toBe(false);
    fixture.grants.pop();
    fixture.grants.push(
      grant({
        principalType: "API_KEY",
        principalId: "other-key",
        roleKey: "custom:role-credential",
      }),
    );
    expect(await keyCheck(fixture, "traces:view")).toBe(false);
  });

  /** @scenario "A key cannot regain access from legacy membership" */
  it("denies a key whose owner has no live grant without reading legacy membership", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ principalType: "API_KEY", principalId: KEY }));
    expect(await keyCheck(fixture, "traces:view")).toBe(false);
    expect(fixture.legacyRead).not.toHaveBeenCalled();
    expect(fixture.migrationRead).not.toHaveBeenCalled();
  });

  it("rechecks custom role edits and removal for a key already issued", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({
        principalType: "API_KEY",
        principalId: KEY,
        roleKey: "custom:key-role",
      }),
      grant({ roleKey: "custom:owner-role" }),
    );
    fixture.roles.push(
      role({ id: "key-role", permissions: ["scenarios:manage"] }),
      role({ id: "owner-role", permissions: ["scenarios:manage"] }),
    );
    expect(await keyCheck(fixture, "scenarios:manage")).toBe(true);
    fixture.roles[1] = role({
      id: "owner-role",
      permissions: ["scenarios:view"],
    });
    expect(await keyCheck(fixture, "scenarios:manage")).toBe(false);
    expect(await keyCheck(fixture, "scenarios:view")).toBe(true);
    fixture.grants.pop();
    expect(await keyCheck(fixture, "scenarios:view")).toBe(false);
  });

  it("batches the same key and owner decisions across permissions and projects", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ principalType: "API_KEY", principalId: KEY }),
      grant({ roleKey: "viewer" }),
    );
    const result = await resolveApiKeyPermissionProjectBatch({
      prisma: fixture.prisma,
      apiKeyId: KEY,
      userId: USER,
      organizationId: ORG,
      projects: [{ projectId: PROJECT, teamId: TEAM }],
      permissions: ["traces:view", "project:update"],
    });
    expect(result.get("traces:view")?.get(PROJECT)).toBe(true);
    expect(result.get("project:update")?.get(PROJECT)).toBe(false);
    expect(fixture.grantFindMany).toHaveBeenCalledTimes(2);
  });
});
