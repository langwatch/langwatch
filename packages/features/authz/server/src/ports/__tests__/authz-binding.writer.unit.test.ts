import { DuplicateBindingError } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthzCompatibilityLedgerPort } from "../authz-compatibility-ledger.port";
import { AuthzBindingWriterService } from "../../services/authz-binding-writer.service";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";

const actor = { type: "user" as const, id: "admin-1" };
const scope = {
  type: "TEAM" as const,
  id: "team-1",
  name: "Shared",
  personalWorkspaceName: null,
};

function ledger() {
  const attachBindings = vi
    .fn<AuthzCompatibilityLedgerPort["attachBindings"]>()
    .mockResolvedValue({ attached: [], duplicates: [] });
  const changeBindingRole = vi
    .fn<AuthzCompatibilityLedgerPort["changeBindingRole"]>()
    .mockResolvedValue(void 0);
  const revokeBindings = vi
    .fn<AuthzCompatibilityLedgerPort["revokeBindings"]>()
    .mockResolvedValue(void 0);
  const port = {
    attachBindings,
    attachResourceGrant: vi.fn<AuthzCompatibilityLedgerPort["attachResourceGrant"]>(),
    revokeResourceGrants: vi.fn<AuthzCompatibilityLedgerPort["revokeResourceGrants"]>(),
    changeBindingRole,
    revokeBindings,
    revokeBindingsWhere: vi.fn<AuthzCompatibilityLedgerPort["revokeBindingsWhere"]>(),
    offboardMember: vi.fn<AuthzCompatibilityLedgerPort["offboardMember"]>(),
    defineRole: vi.fn<AuthzCompatibilityLedgerPort["defineRole"]>(),
    deleteRole: vi.fn<AuthzCompatibilityLedgerPort["deleteRole"]>(),
  } satisfies AuthzCompatibilityLedgerPort;

  return { port, attachBindings, changeBindingRole, revokeBindings };
}

function setup() {
  const bindings = new StubAuthzBindingRepository();
  bindings.findScopeRows.mockResolvedValue([scope]);
  bindings.tryFindOrganizationRole.mockResolvedValue("MEMBER");
  bindings.isGroupInOrganization.mockResolvedValue(true);
  bindings.isApiKeyInOrganization.mockResolvedValue(true);
  const writes = ledger();
  const writer = AuthzBindingWriterService.create({
    bindings,
    ledger: writes.port,
    newBindingId: () => "binding-new",
  });
  return { bindings, writes, writer };
}

const createInput = {
  organizationId: "org-1",
  userId: "user-1",
  role: "MEMBER" as const,
  scopeType: "TEAM" as const,
  scopeId: "team-1",
  actor,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Authz binding management writes", () => {
  it("rejects a missing or ambiguous principal before emitting a command", async () => {
    const { writes, writer } = setup();

    await expect(writer.create({ ...createInput, userId: undefined })).rejects.toMatchObject({
      code: "role_binding_principal_invalid",
    });
    await expect(writer.create({ ...createInput, groupId: "group-1" })).rejects.toMatchObject({
      code: "role_binding_principal_invalid",
    });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("checks every principal against the target organization", async () => {
    const { bindings, writes, writer } = setup();
    bindings.tryFindOrganizationRole.mockResolvedValue(null);

    await expect(writer.create(createInput)).rejects.toMatchObject({
      code: "user_not_in_organization",
      httpStatus: 422,
    });

    bindings.isGroupInOrganization.mockResolvedValue(false);
    await expect(
      writer.create({ ...createInput, userId: undefined, groupId: "foreign-group" }),
    ).rejects.toMatchObject({ code: "group_not_in_organization" });

    bindings.isApiKeyInOrganization.mockResolvedValue(false);
    await expect(
      writer.create({ ...createInput, userId: undefined, apiKeyId: "foreign-key" }),
    ).rejects.toMatchObject({ code: "api_key_not_in_organization" });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("refuses a foreign scope without disclosing whether it exists", async () => {
    const { bindings, writes, writer } = setup();
    bindings.findScopeRows.mockResolvedValue([]);

    await expect(writer.create(createInput)).rejects.toMatchObject({
      code: "scope_not_in_organization",
      meta: { scopeType: "TEAM" },
    });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("refuses writes into a personal workspace", async () => {
    const { bindings, writes, writer } = setup();
    bindings.findScopeRows.mockResolvedValue([
      { ...scope, personalWorkspaceName: "Alice's Workspace" },
    ]);

    await expect(writer.create(createInput)).rejects.toMatchObject({
      code: "personal_workspace_not_managed_here",
      meta: { ownerName: "Alice's Workspace" },
    });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("requires an assignable custom role and enforces the scope fence", async () => {
    const { bindings, writes, writer } = setup();
    const custom = { ...createInput, role: "CUSTOM" as const };

    await expect(writer.create(custom)).rejects.toMatchObject({
      code: "custom_role_id_required",
    });

    bindings.findAssignableRoles.mockResolvedValue([]);
    await expect(writer.create({ ...custom, customRoleId: "role-foreign" })).rejects.toMatchObject({
      code: "custom_role_not_assignable",
    });

    bindings.findAssignableRoles.mockResolvedValue([
      { id: "role-1", permissions: ["organization:manage", "traces:view"] },
    ]);
    await expect(writer.create({ ...custom, customRoleId: "role-1" })).rejects.toMatchObject({
      code: "org_exclusive_permission_scope",
      meta: { permission: "organization:manage", scopeType: "TEAM" },
    });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("allows an organization-exclusive custom role at organization scope", async () => {
    const { bindings, writes, writer } = setup();
    bindings.findScopeRows.mockResolvedValue([
      {
        type: "ORGANIZATION",
        id: "org-1",
        name: "Acme",
        personalWorkspaceName: null,
      },
    ]);
    bindings.findAssignableRoles.mockResolvedValue([
      { id: "role-1", permissions: ["organization:manage"] },
    ]);

    await expect(
      writer.create({
        ...createInput,
        role: "CUSTOM",
        customRoleId: "role-1",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
      }),
    ).resolves.toEqual({ id: "binding-new" });
    expect(writes.attachBindings).toHaveBeenCalledOnce();
  });

  it("ceilings lite members to viewer outside organization scope", async () => {
    const { bindings, writes, writer } = setup();
    bindings.tryFindOrganizationRole.mockResolvedValue("EXTERNAL");

    await expect(writer.create(createInput)).rejects.toMatchObject({
      code: "lite_member_viewer_only",
      meta: { teamName: "Shared" },
    });
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });

  it("emits one ledger attach and maps duplicate storage signals", async () => {
    const { writes, writer } = setup();

    await expect(writer.create(createInput)).resolves.toEqual({ id: "binding-new" });
    expect(writes.attachBindings).toHaveBeenCalledWith({
      organizationId: "org-1",
      bindings: [
        {
          bindingId: "binding-new",
          principal: { userId: "user-1" },
          role: "MEMBER",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team-1",
        },
      ],
      actor,
      onDuplicate: "reject",
    });

    writes.attachBindings.mockRejectedValue(new DuplicateBindingError());
    await expect(writer.create(createInput)).rejects.toMatchObject({
      code: "role_binding_already_exists",
      httpStatus: 409,
      meta: { scopeType: "TEAM", scopeId: "team-1" },
    });
  });

  it("does not reveal or mutate a binding from another organization", async () => {
    const { bindings, writes, writer } = setup();
    bindings.tryFindBinding.mockResolvedValue(null);

    await expect(
      writer.update({
        organizationId: "org-1",
        bindingId: "binding-foreign",
        role: "VIEWER",
        actor,
      }),
    ).rejects.toMatchObject({ code: "role_binding_not_found", httpStatus: 404 });
    expect(writes.changeBindingRole).not.toHaveBeenCalled();
  });

  it("validates a member batch before revoking, then revokes before attaching", async () => {
    const { bindings, writes, writer } = setup();
    bindings.findDirectUserBindings.mockResolvedValue([
      {
        id: "binding-old",
        organizationId: "org-1",
        userId: "user-1",
        groupId: null,
        apiKeyId: null,
        role: "VIEWER",
        customRoleId: null,
        scopeType: "TEAM",
        scopeId: "team-1",
      },
    ]);

    await writer.applyMemberBindings({
      organizationId: "org-1",
      userId: "user-1",
      bindingIdsToDelete: ["binding-old", "binding-already-gone"],
      bindingsToCreate: [
        {
          role: "VIEWER",
          scopeType: "TEAM",
          scopeId: "team-1",
        },
      ],
      actor,
    });

    expect(writes.revokeBindings).toHaveBeenCalledWith({
      organizationId: "org-1",
      bindingIds: ["binding-old"],
      actor,
    });
    expect(writes.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({ onDuplicate: "skip" }),
    );
    const revokeOrder = writes.revokeBindings.mock.invocationCallOrder.at(0);
    const attachOrder = writes.attachBindings.mock.invocationCallOrder.at(0);
    if (revokeOrder === void 0 || attachOrder === void 0) {
      throw new Error("expected both binding commands to be emitted");
    }

    expect(revokeOrder).toBeLessThan(attachOrder);
  });

  it("rejects a foreign member batch before emitting either command", async () => {
    const { bindings, writes, writer } = setup();
    bindings.tryFindOrganizationRole.mockResolvedValue(null);

    await expect(
      writer.applyMemberBindings({
        organizationId: "org-1",
        userId: "foreign-user",
        bindingIdsToDelete: ["binding-old"],
        bindingsToCreate: [{ role: "VIEWER", scopeType: "TEAM", scopeId: "team-1" }],
        actor,
      }),
    ).rejects.toMatchObject({ code: "user_not_in_organization" });
    expect(writes.revokeBindings).not.toHaveBeenCalled();
    expect(writes.attachBindings).not.toHaveBeenCalled();
  });
});
