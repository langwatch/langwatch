import { describe, expect, it, vi } from "vitest";
import {
  credentialFixture,
  GROUP,
  grant,
  ORG,
  TEAM,
  USER,
} from "~/server/app-layer/authz/__tests__/credential-permissions.fixture";
import { ApiKeyService } from "../api-key.service";
import { CliLoginKeyService } from "../cli-login-key.service";

vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ({}),
}));

function fixture() {
  const facts = credentialFixture();
  const service = new CliLoginKeyService({
    prisma: facts.prisma,
    apiKeyService: ApiKeyService.create(facts.prisma),
    ingestKeys: { revokeForSession: vi.fn() },
  });
  const selection = () =>
    service.resolveDefaultSelection({ userId: USER, organizationId: ORG });
  return { ...facts, selection };
}

describe("CLI default scopes use current grants", () => {
  it("includes a team reached only through a group grant and drops unrelated teams", async () => {
    const subject = fixture();
    subject.projects.push({ id: "other-project", teamId: "other-team" });
    subject.groups.push({ userId: USER, groupId: GROUP, organizationId: ORG });
    subject.grants.push(
      grant({ principalType: "GROUP", principalId: GROUP, roleKey: "viewer" }),
    );

    const selection = await subject.selection();
    expect(selection?.bindings).toEqual([{ scopeType: "TEAM", scopeId: TEAM }]);
    expect(selection?.permissions).toContain("traces:view");
    expect(selection?.permissions).not.toContain("traces:create");
    expect(subject.legacyRead).not.toHaveBeenCalled();
    expect(subject.migrationRead).not.toHaveBeenCalled();

    subject.groups.length = 0;
    expect(await subject.selection()).toBeNull();
  });

  it("does not treat the old organization admin role as an admin grant", async () => {
    const subject = fixture();
    subject.memberships.set(USER, { role: "ADMIN", disabledAt: null });
    expect(await subject.selection()).toBeNull();

    subject.grants.push(
      grant({ roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG }),
    );
    expect((await subject.selection())?.bindings).toEqual([
      { scopeType: "ORGANIZATION", scopeId: ORG },
    ]);

    subject.memberships.set(USER, { role: "EXTERNAL", disabledAt: null });
    expect((await subject.selection())?.bindings).not.toEqual([
      { scopeType: "ORGANIZATION", scopeId: ORG },
    ]);

    subject.memberships.set(USER, { role: "ADMIN", disabledAt: new Date() });
    expect(await subject.selection()).toBeNull();
  });
});
