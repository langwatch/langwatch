/**
 * A key is handed out only once its grants are readable.
 *
 * A key row is a plain insert and its grants are ledger commands, so the two
 * cannot share a transaction. Ordering is the only fail-safety left: the row is
 * written revoked, the grants go next, and the row is un-revoked last. A grant
 * write that is durable but not yet readable refuses here rather than passing.
 *
 * @see specs/api-keys/unified-api-keys.feature
 */
import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const EXISTING_ID = "key_existing";

const existing = {
  id: EXISTING_ID,
  name: "Existing Key",
  description: null,
  organizationId: ORG_ID,
  userId: USER_ID,
  createdByUserId: USER_ID,
  createdByDeviceLabel: null,
  permissionMode: "all",
  revokedAt: null,
  hashedSecret: "hashed",
  roleBindings: [
    {
      id: "rb_old",
      customRoleId: null,
      role: "ADMIN",
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
    },
  ],
} as unknown as StoredApiKey;

type LedgerFailure = "attach" | "role" | null;

function makeService(failure: LedgerFailure) {
  const repository = {
    create: vi.fn(async (input: Record<string, unknown>) => ({
      ...existing,
      ...input,
      id: "key_new",
      revokedAt: input.startsDisabled ? new Date() : null,
    })),
    activate: vi.fn(async () => ({ ...existing, id: "key_new", revokedAt: null })),
    update: vi.fn(async () => existing),
    tryFindByIdInOrganization: vi.fn(async () => existing),
  } as unknown as ApiKeyRepository;

  const grantCalls: Array<Record<string, unknown>> = [];
  const dependencies = {
    authz: {
      hasPermission: async () => true,
      can: async () => true,
      listUserBindings: async () => [],
      listScopeBindings: async () => [],
      listUserCreatedRoles: async () => [{ id: "role_1", permissions: ["langy:view"] }],
    },
    grants: {
      defineRole: async (input: Record<string, unknown>) => {
        grantCalls.push({ method: "defineRole", ...input });
        if (failure === "role") throw new AuthzGrantNotConfirmedError();
      },
      attachBindings: async (input: Record<string, unknown>) => {
        grantCalls.push({ method: "attachBindings", ...input });
        if (failure === "attach") throw new AuthzGrantNotConfirmedError();
        return { attached: ["rb_new"], duplicates: [] };
      },
      revokeBindingsWhere: async (input: Record<string, unknown>) => {
        grantCalls.push({ method: "revokeBindingsWhere", ...input });
      },
      deleteRole: vi.fn(),
    },
    organizations: { getTeam: async () => ({ id: "team_1" }) },
    projects: {
      getWithTeam: async () => ({
        archivedAt: null,
        team: { id: "team_1", organizationId: ORG_ID },
      }),
    },
    bindingIds: { generateBindingId: () => "rb_new" },
    legacyGrants: {} as never,
    tokens: {
      generate: () => ({
        token: "sk-lw-lookup_secret",
        lookupId: "lookup",
        hashedSecret: "hashed",
      }),
    },
  } as never;

  const policy = ApiKeyGrantPolicyService.create({
    ...(dependencies as object),
    repository,
  } as never);
  const service = ApiKeyLifecycleService.create(
    { ...(dependencies as object), repository } as never,
    policy,
  );
  return { service, repository, grantCalls };
}

const CALLER = { callerUserId: USER_ID, callerIsAdmin: true, organizationId: ORG_ID };
const ORG_BINDING = { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID } as const;
const CUSTOM_BINDING = { role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID } as const;

/** The code of a handled failure, or the error itself when it is not one. */
async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

describe("given a create whose grants do not become readable", () => {
  /** @scenario "A key whose grants did not become readable is never activated" */
  it("leaves the row revoked and returns no token", async () => {
    const { service, repository } = makeService("attach");

    expect(
      await codeOf(() =>
        service.create({
          name: "Automation Key",
          userId: null,
          organizationId: ORG_ID,
          permissionMode: "all",
          bindings: [ORG_BINDING],
        }),
      ),
    ).toBe("authz_grant_not_confirmed");

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ startsDisabled: true }),
    );
    expect(repository.activate).not.toHaveBeenCalled();
  });

  /** @scenario "A key whose custom role did not become readable is never activated" */
  it("leaves a restricted key revoked when its role does not become readable", async () => {
    const { service, repository } = makeService("role");

    expect(
      await codeOf(() =>
        service.create({
          name: "Restricted Key",
          userId: null,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["langy:view"],
          bindings: [CUSTOM_BINDING],
        }),
      ),
    ).toBe("authz_grant_not_confirmed");

    expect(repository.activate).not.toHaveBeenCalled();
  });
});

describe("given a create whose grants become readable", () => {
  /** @scenario "A key whose grants are readable is activated and returned" */
  it("requires the projection, activates the row and returns the token", async () => {
    const { service, repository, grantCalls } = makeService(null);

    const { token, apiKey } = await service.create({
      name: "Automation Key",
      userId: null,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [ORG_BINDING],
    });

    expect(grantCalls).toContainEqual(
      expect.objectContaining({ method: "attachBindings", requireProjection: true }),
    );
    expect(repository.activate).toHaveBeenCalledTimes(1);
    expect(apiKey.revokedAt).toBeNull();
    expect(token).toContain("sk-lw-");
  });
});

describe("given a replace whose new grants do not become readable", () => {
  /** @scenario "Replacing a key's grants keeps the old ones when the new ones do not land" */
  it("revokes nothing the key already held", async () => {
    const { service, grantCalls } = makeService("attach");

    expect(
      await codeOf(() => service.update({ id: EXISTING_ID, ...CALLER, bindings: [ORG_BINDING] })),
    ).toBe("authz_grant_not_confirmed");

    expect(grantCalls.map((call) => call.method)).not.toContain("revokeBindingsWhere");
  });

  /** @scenario "Replacing a key's grants leaves its metadata alone when the new ones do not land" */
  it("leaves the key's own row alone", async () => {
    const { service, repository } = makeService("attach");

    await codeOf(() =>
      service.update({
        id: EXISTING_ID,
        ...CALLER,
        permissionMode: "restricted",
        permissions: ["langy:view"],
        bindings: [CUSTOM_BINDING],
      }),
    );

    expect(repository.update).not.toHaveBeenCalled();
  });
});
