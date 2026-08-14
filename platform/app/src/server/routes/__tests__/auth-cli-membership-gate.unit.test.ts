/**
 * @vitest-environment node
 *
 * The two-organization test ADR-094 Decision 4 requires to ship beside the
 * write flip: directory offboarding now disables the MEMBERSHIP instead of
 * switching the whole account off, so a gate that reads only the global flag
 * and the membership's existence goes stale — a person removed from org A by
 * their directory would keep minting org A's keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const orgFindUnique = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({
  prisma: {
    user: { findUnique },
    organizationUser: { findUnique: orgFindUnique },
  },
}));

// The refusal path severs the presented token in Redis; there is none here,
// and the call is already wrapped in a warn-and-continue.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

const { ensureActiveOrgMemberOr403 } = await import("../auth-cli");

const context = () =>
  ({
    req: { header: () => undefined },
    json: (body: unknown, status: number) =>
      ({ body, status }) as unknown as Response,
  }) as never;

const call = (organizationId: string) =>
  ensureActiveOrgMemberOr403(context(), {
    user_id: "alice",
    organization_id: organizationId,
  });

describe("the CLI key-minting membership gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ deactivatedAt: null });
  });

  describe("given a person whose membership of org A was disabled by its directory", () => {
    it("refuses in org A", async () => {
      orgFindUnique.mockResolvedValue({
        userId: "alice",
        disabledAt: new Date("2026-06-01T00:00:00Z"),
      });

      const refusal = (await call("org-a")) as unknown as {
        status: number;
        body: { error: string };
      };

      expect(refusal?.status).toBe(403);
      expect(refusal?.body.error).toBe("forbidden");
    });

    it("leaves org B alone, where the membership is still active", async () => {
      orgFindUnique.mockResolvedValue({ userId: "alice", disabledAt: null });

      expect(await call("org-b")).toBeNull();
    });
  });

  describe("given the account itself is deactivated", () => {
    it("refuses even where a membership row survives", async () => {
      findUnique.mockResolvedValue({
        deactivatedAt: new Date("2026-06-01T00:00:00Z"),
      });
      orgFindUnique.mockResolvedValue({ userId: "alice", disabledAt: null });

      const refusal = (await call("org-a")) as unknown as { status: number };
      expect(refusal?.status).toBe(403);
    });
  });

  describe("given the person was never a member", () => {
    it("refuses", async () => {
      orgFindUnique.mockResolvedValue(null);

      const refusal = (await call("org-a")) as unknown as { status: number };
      expect(refusal?.status).toBe(403);
    });
  });
});
