import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import {
  credentialFixture,
  GROUP,
  grant,
  ORG,
  PROJECT,
  role,
  TEAM,
  USER,
} from "~/server/app-layer/authz/__tests__/credential-permissions.fixture";
import { ApiKeyService } from "../api-key.service";

vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ({ attachBindings: vi.fn(), defineRole: vi.fn() }),
}));

function fixture() {
  const facts = credentialFixture();
  Object.assign(facts.prisma.project, {
    findFirst: vi.fn(async ({ where }: Prisma.ProjectFindFirstArgs = {}) =>
      where?.OR
        ? null
        : {
            id: PROJECT,
            teamId: TEAM,
            team: { id: TEAM, organizationId: ORG },
          },
    ),
  });
  const create = vi.fn();
  Object.assign(facts.prisma.apiKey, { create });
  const service = ApiKeyService.create(facts.prisma);
  const selection = (permissions: string[]) =>
    service.assertSelectionWithinCeiling({
      userId: USER,
      organizationId: ORG,
      permissions,
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT }],
    });
  return { ...facts, service, selection, create };
}

describe("API key selection uses current grants", () => {
  it("accepts direct and group grants and rejects permissions above their ceiling", async () => {
    const subject = fixture();
    subject.grants.push(grant({ roleKey: "viewer" }));
    await expect(subject.selection(["traces:view"])).resolves.toBeUndefined();
    await expect(subject.selection(["traces:create"])).rejects.toThrow(
      /exceeds your own access/,
    );
    subject.grants.push(grant({ principalType: "GROUP", principalId: GROUP }));
    subject.groups.push({ userId: USER, groupId: GROUP, organizationId: ORG });
    await expect(subject.selection(["traces:create"])).resolves.toBeUndefined();
    expect(subject.legacyRead).not.toHaveBeenCalled();
    expect(subject.migrationRead).not.toHaveBeenCalled();
  });

  it("rejects legacy-only access before creating a credential", async () => {
    const subject = fixture();
    await expect(
      subject.service.create({
        name: "Restricted test",
        userId: USER,
        organizationId: ORG,
        permissionMode: "restricted",
        permissions: ["traces:view"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT }],
      }),
    ).rejects.toThrow(/exceeds your own access/);
    expect(subject.create).not.toHaveBeenCalled();
    expect(subject.legacyRead).not.toHaveBeenCalled();
  });

  it("refuses an unrelated team's grant and a team-scoped org permission", async () => {
    const subject = fixture();
    subject.grants.push(grant({ roleKey: "admin", scopeId: "other-team" }));
    await expect(subject.selection(["traces:view"])).rejects.toThrow(
      /exceeds your own access/,
    );
    subject.grants.push(grant({ roleKey: "custom:role-credential" }));
    subject.roles.push(
      role({ permissions: ["governance:manage", "traces:view"] }),
    );
    await expect(subject.selection(["governance:manage"])).rejects.toThrow(
      /exceeds your own access/,
    );
    await expect(subject.selection(["traces:view"])).resolves.toBeUndefined();
  });

  it("keeps the lite-member ceiling even when a grant carries admin", async () => {
    const subject = fixture();
    subject.memberships.set(USER, { role: "EXTERNAL", disabledAt: null });
    subject.grants.push(grant({ roleKey: "admin" }));
    await expect(subject.selection(["secrets:manage"])).rejects.toThrow(
      /exceeds your own access/,
    );
    await expect(subject.selection(["traces:view"])).resolves.toBeUndefined();
  });
});
