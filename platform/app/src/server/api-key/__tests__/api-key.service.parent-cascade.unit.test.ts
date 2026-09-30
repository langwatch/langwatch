/**
 * Revoking a key retires the keys minted under it, from every entry point.
 *
 * The parent link is a property of the row, and the revoke reaches it from
 * the API-keys page, the REST route and the tRPC mutation as well as from a
 * `langwatch logout`. A cascade that lived in one caller was one the other
 * three skipped, which left a live ingestion credential under a dead login.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "../api-key.service";

const LOGIN = "ak_login";
const ORG = "org_1";

interface Row {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  revokedAt: Date | null;
  revocationCause?: string;
  roleBindings: never[];
  parentApiKeyId: string | null;
}

function keyRow(overrides: Partial<Row> = {}): Row {
  return {
    id: LOGIN,
    organizationId: ORG,
    userId: "user_1",
    name: "CLI login key laptop",
    revokedAt: null,
    roleBindings: [],
    parentApiKeyId: null,
    ...overrides,
  };
}

function serviceWith({ children }: { children: Array<{ id: string }> }) {
  const rows = new Map<string, Row>();
  rows.set(LOGIN, keyRow());
  for (const child of children) {
    rows.set(child.id, keyRow({ id: child.id, parentApiKeyId: LOGIN }));
  }

  const repo = {
    findById: vi.fn(async ({ id }: { id: string }) => rows.get(id) ?? null),
    revoke: vi.fn(async ({ id, cause }: { id: string; cause: string }) => {
      const row = rows.get(id)!;
      const revoked = { ...row, revokedAt: new Date(), revocationCause: cause };
      rows.set(id, revoked);
      return revoked;
    }),
    findLiveChildren: vi.fn(async () => children),
  };

  const service = new ApiKeyService({
    prisma: {} as never,
    repo: repo as never,
    roleRepo: {} as never,
    mintLegacyGrant: vi.fn(),
  });
  return { service, repo, rows };
}

describe("ApiKeyService.revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a login key with ingestion keys minted under it", () => {
    /** @scenario "Revoking a login key from the API keys page retires its ingest keys" */
    it("retires each child, recording that the session went rather than a decision about it", async () => {
      const { service, repo } = serviceWith({
        children: [{ id: "ak_child_a" }, { id: "ak_child_b" }],
      });

      await service.revoke({
        id: LOGIN,
        callerUserId: "user_1",
        callerIsAdmin: false,
        organizationId: ORG,
      });

      expect(repo.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: LOGIN, cause: "user" }),
      );
      // A person revoking the login did not make a decision about each key.
      expect(repo.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_child_a", cause: "session" }),
      );
      expect(repo.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_child_b", cause: "session" }),
      );
    });

    /** @scenario "A cascade that fails does not fail the logout" */
    it("still reports the parent revoked when reading the children fails", async () => {
      const { service, repo } = serviceWith({ children: [] });
      repo.findLiveChildren.mockRejectedValue(new Error("postgres is down"));

      await expect(
        service.revoke({
          id: LOGIN,
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: ORG,
        }),
      ).resolves.toMatchObject({ id: LOGIN });
    });

    it("does not recurse: a child's own revoke looks for no children", async () => {
      const { service, repo } = serviceWith({ children: [{ id: "ak_child" }] });

      await service.revoke({
        id: LOGIN,
        callerUserId: "user_1",
        callerIsAdmin: false,
        organizationId: ORG,
      });

      expect(repo.findLiveChildren).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a key nothing was minted under", () => {
    it("revokes it and nothing else", async () => {
      const { service, repo } = serviceWith({ children: [] });

      await service.revoke({
        id: LOGIN,
        callerUserId: "user_1",
        callerIsAdmin: false,
        organizationId: ORG,
      });

      expect(repo.revoke).toHaveBeenCalledTimes(1);
    });
  });
});
