import { type Secret, SecretNotFoundError } from "@langwatch/secret-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const deleteSecret = vi.fn();

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("../../rbac", () => ({
  resolveProjectPermission: vi
    .fn()
    .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
}));

vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));

import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

function caller() {
  const actor = () => ({ id: "user-1" });
  const getDecision = vi.fn().mockResolvedValue({ permitted: true, organizationRole: "MEMBER" });

  return secretsRouter.createCaller({
    session: { user: { id: "user-1" }, expires: "1" },
    app: {
      permissions: {
        getDecision,
        // The declared policy runs the scope-lineage guard ahead of the
        // permission check, and every id here belongs to one project.
        checkScopeLineage: async () => ({ kind: "consistent" }),
      },
      secrets: {
        list,
        create,
        update,
        delete: deleteSecret,
      },
    },
    actor,
    authorize: async (permission: string, target: { projectId: string }) => {
      const decision = await getDecision({
        userId: actor().id,
        permission,
        scope: { tier: "project", id: target.projectId },
      });
      if (!decision.permitted) throw new Error("permission denied");
    },
    can: async () => true,
    permissionChecked: true,
  } as never);
}

describe("secrets tRPC compatibility adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates list and create to the canonical App service", async () => {
    list.mockResolvedValueOnce([secret]);
    create.mockResolvedValueOnce(secret);

    await expect(caller().list({ projectId: "project-1" })).resolves.toEqual([secret]);
    await expect(
      caller().create({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "value",
      }),
    ).resolves.toEqual(secret);

    expect(list).toHaveBeenCalledWith({ projectId: "project-1" });
    // The actor rides beside the input, not inside it: `createSecretInputSchema`
    // omits `actorId` at the transport precisely so a caller cannot name a
    // different one, and the transport supplies `ctx.actor()` itself.
    expect(create).toHaveBeenCalledWith(
      { projectId: "project-1", name: "MY_SECRET", value: "value" },
      { id: "user-1" },
    );
  });

  it("maps a canonical not-found error to the existing tRPC code", async () => {
    deleteSecret.mockRejectedValueOnce(new SecretNotFoundError());

    await expect(
      caller().delete({ projectId: "project-1", secretId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps the existing update and delete response shapes", async () => {
    update.mockResolvedValueOnce(secret);
    deleteSecret.mockResolvedValueOnce(undefined);

    await expect(
      caller().update({
        projectId: "project-1",
        secretId: "secret-1",
        value: "rotated",
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller().delete({ projectId: "project-1", secretId: "secret-1" }),
    ).resolves.toEqual({ success: true });
  });
});
