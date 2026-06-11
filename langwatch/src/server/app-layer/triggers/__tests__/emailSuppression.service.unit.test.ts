import { beforeEach, describe, expect, it } from "vitest";
import type {
  EmailSuppressionRepository,
  EmailSuppressionRow,
} from "../repositories/emailSuppression.repository";
import { EmailSuppressionService } from "../emailSuppression.service";

class FakeRepo implements EmailSuppressionRepository {
  rows: EmailSuppressionRow[] = [];
  private seq = 0;

  async findAllForProject({ projectId }: { projectId: string }) {
    return this.rows.filter((r) => r.projectId === projectId);
  }

  async create(params: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }) {
    const existing = this.rows.find(
      (r) =>
        r.projectId === params.projectId &&
        r.email === params.email &&
        r.triggerId === params.triggerId,
    );
    if (existing) return existing;
    const row: EmailSuppressionRow = {
      id: `s_${this.seq++}`,
      createdAt: new Date(),
      ...params,
    };
    this.rows.push(row);
    return row;
  }

  async delete({ projectId, id }: { projectId: string; id: string }) {
    this.rows = this.rows.filter(
      (r) => !(r.id === id && r.projectId === projectId),
    );
  }

  async findMatching({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }) {
    return this.rows.filter(
      (r) =>
        r.projectId === projectId &&
        (r.triggerId === null || r.triggerId === triggerId),
    );
  }
}

describe("EmailSuppressionService", () => {
  let repo: FakeRepo;
  let service: EmailSuppressionService;

  beforeEach(() => {
    repo = new FakeRepo();
    service = new EmailSuppressionService(repo);
  });

  describe("given a suppression is recorded", () => {
    describe("when the email has mixed casing and whitespace", () => {
      it("normalizes the stored email to lowercase", async () => {
        await service.suppress({
          projectId: "p1",
          email: "  USER@Example.com ",
          triggerId: "t1",
          reason: "unsubscribe",
        });
        expect(repo.rows[0]?.email).toBe("user@example.com");
      });
    });

    describe("when the same address is suppressed twice", () => {
      it("does not create a duplicate row", async () => {
        await service.suppress({ projectId: "p1", email: "a@b.com", triggerId: "t1" });
        await service.suppress({ projectId: "p1", email: "A@B.com", triggerId: "t1" });
        expect(repo.rows).toHaveLength(1);
      });
    });
  });

  describe("given rows exist for a project", () => {
    describe("when getAllForProject is called", () => {
      it("returns that project's rows", async () => {
        await service.suppress({ projectId: "p1", email: "a@b.com", triggerId: null });
        await service.suppress({ projectId: "p2", email: "c@d.com", triggerId: null });
        const rows = await service.getAllForProject({ projectId: "p1" });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.email).toBe("a@b.com");
      });
    });

    describe("when a row is removed", () => {
      it("drops it from the project's list", async () => {
        const row = await service.suppress({
          projectId: "p1",
          email: "a@b.com",
          triggerId: null,
        });
        await service.remove({ projectId: "p1", id: row.id });
        expect(await service.getAllForProject({ projectId: "p1" })).toHaveLength(0);
      });
    });
  });

  describe("given a trigger-scoped and a project-wide suppression", () => {
    beforeEach(async () => {
      await service.suppress({ projectId: "p1", email: "trigger@x.com", triggerId: "t1" });
      await service.suppress({ projectId: "p1", email: "project@x.com", triggerId: null });
    });

    describe("when filtering recipients for that trigger", () => {
      it("removes both the trigger-scoped and project-wide addresses", async () => {
        const remaining = await service.filterSuppressed({
          projectId: "p1",
          triggerId: "t1",
          emails: ["Trigger@X.com", "project@x.com", "ok@x.com"],
        });
        expect(remaining).toEqual(["ok@x.com"]);
      });
    });

    describe("when filtering recipients for a different trigger", () => {
      it("keeps the trigger-scoped address but still drops the project-wide one", async () => {
        const remaining = await service.filterSuppressed({
          projectId: "p1",
          triggerId: "t2",
          emails: ["trigger@x.com", "project@x.com"],
        });
        expect(remaining).toEqual(["trigger@x.com"]);
      });
    });
  });
});
