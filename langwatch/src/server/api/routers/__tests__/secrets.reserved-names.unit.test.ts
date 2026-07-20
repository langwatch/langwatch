/**
 * Product-owned project secrets — today `langy_vk_secret`, which holds the
 * plaintext secret of the project's auto-provisioned Langy virtual key.
 *
 * Deleting that row does more than break the current key: Langy treats its
 * presence as "this project already has a VK", so the next chat mints a
 * duplicate while the original stays active. The row is hidden from the
 * listing and the by-id mutations refuse it, reported as not-found so the
 * response doesn't confirm it exists.
 */
import { describe, expect, it, vi } from "vitest";

import { LANGY_VK_SECRET_NAME } from "~/server/projects/reserved-secret-names";

const findMany = vi.fn().mockResolvedValue([]);
const findFirst = vi.fn();
const deleteFn = vi.fn().mockResolvedValue({ id: "sec_1" });
const update = vi.fn().mockResolvedValue({ id: "sec_1" });

vi.mock("~/server/db", () => ({
  prisma: {
    projectSecret: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      delete: (...a: unknown[]) => deleteFn(...a),
      update: (...a: unknown[]) => update(...a),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

// Permission enforcement is covered by rbac.secrets.test.ts; this suite is
// about what a correctly-permissioned caller may still not touch.
vi.mock("../../rbac", () => ({
  checkProjectPermission: () => async (opts: { next: () => unknown }) =>
    opts.next(),
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v,
}));

// The global mutation middleware writes an audit row; not what this suite is about.
vi.mock("~/server/auditLog", () => ({ auditLog: vi.fn() }));

import { secretsRouter } from "../secrets";

function caller() {
  return secretsRouter.createCaller({
    session: { user: { id: "user_1" }, expires: "1" },
    prisma: {
      projectSecret: {
        findMany: (...a: unknown[]) => findMany(...a),
        findFirst: (...a: unknown[]) => findFirst(...a),
        delete: (...a: unknown[]) => deleteFn(...a),
        update: (...a: unknown[]) => update(...a),
      },
    },
    permissionChecked: true,
  } as never);
}

const projectId = "proj_1";

describe("secrets router reserved-name guard", () => {
  describe("when listing a project's secrets", () => {
    it("excludes product-owned rows from the query", async () => {
      await caller().list({ projectId });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId,
            name: { notIn: expect.arrayContaining([LANGY_VK_SECRET_NAME]) },
          }),
        }),
      );
    });
  });

  describe("given the caller targets the Langy virtual-key secret by id", () => {
    it("refuses to delete it, reporting not-found", async () => {
      findFirst.mockResolvedValueOnce({
        id: "sec_1",
        name: LANGY_VK_SECRET_NAME,
      });

      await expect(
        caller().delete({ projectId, secretId: "sec_1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(deleteFn).not.toHaveBeenCalled();
    });

    it("refuses to overwrite its value, reporting not-found", async () => {
      findFirst.mockResolvedValueOnce({
        id: "sec_1",
        name: LANGY_VK_SECRET_NAME,
      });

      await expect(
        caller().update({ projectId, secretId: "sec_1", value: "hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given the caller targets one of their own secrets", () => {
    it("deletes it", async () => {
      findFirst.mockResolvedValueOnce({ id: "sec_2", name: "MY_API_KEY" });

      await expect(
        caller().delete({ projectId, secretId: "sec_2" }),
      ).resolves.toEqual({ success: true });
      expect(deleteFn).toHaveBeenCalled();
    });
  });
});
