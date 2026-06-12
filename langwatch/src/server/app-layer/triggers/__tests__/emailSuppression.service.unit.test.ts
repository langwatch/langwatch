import { beforeEach, describe, expect, it } from "vitest";
import { signUnsubscribeToken } from "~/server/mailer/unsubscribeToken";
import {
  EmailSuppressionService,
  InvalidUnsubscribeTokenError,
  maskEmail,
} from "../emailSuppression.service";
import type {
  EmailSuppressionNameLookupRepository,
  EmailSuppressionRepository,
  EmailSuppressionRow,
  UnsubscribeNames,
} from "../repositories/emailSuppression.repository";

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

class FakeNameLookup implements EmailSuppressionNameLookupRepository {
  private triggers: Map<string, string>;
  private projects: Map<string, string>;

  constructor({
    projects = new Map<string, string>(),
    triggers = new Map<string, string>(),
  }: {
    projects?: Map<string, string>;
    triggers?: Map<string, string>;
  } = {}) {
    this.projects = projects;
    this.triggers = triggers;
  }

  async lookupNames({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null> {
    const projectName = this.projects.get(projectId);
    if (!projectName) return null;
    const triggerName =
      triggerId != null ? (this.triggers.get(triggerId) ?? null) : null;
    return { projectName, triggerName };
  }

  async findTriggerNames({
    triggerIds,
  }: {
    projectId: string;
    triggerIds: string[];
  }): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of triggerIds) {
      const name = this.triggers.get(id);
      if (name) result.set(id, name);
    }
    return result;
  }
}

describe("maskEmail", () => {
  describe("given an ordinary address", () => {
    describe("when masking", () => {
      it("keeps the first letter and the domain", () => {
        expect(maskEmail("alice@example.com")).toBe("a***@example.com");
      });
    });
  });

  describe("given a single-character local part", () => {
    describe("when masking", () => {
      it("still masks without leaking the character count", () => {
        expect(maskEmail("a@example.com")).toBe("a***@example.com");
      });
    });
  });
});

describe("EmailSuppressionService", () => {
  let repo: FakeRepo;
  let nameLookup: FakeNameLookup;
  let service: EmailSuppressionService;

  beforeEach(() => {
    repo = new FakeRepo();
    nameLookup = new FakeNameLookup({
      projects: new Map([
        ["p1", "Project One"],
        ["p2", "Project Two"],
      ]),
      triggers: new Map([
        ["t1", "Trigger Alpha"],
        ["t2", "Trigger Beta"],
      ]),
    });
    service = new EmailSuppressionService(repo, nameLookup);
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
        await service.suppress({
          projectId: "p1",
          email: "a@b.com",
          triggerId: "t1",
        });
        await service.suppress({
          projectId: "p1",
          email: "A@B.com",
          triggerId: "t1",
        });
        expect(repo.rows).toHaveLength(1);
      });
    });
  });

  describe("given rows exist for a project", () => {
    describe("when getAllForProject is called", () => {
      it("returns that project's rows", async () => {
        await service.suppress({
          projectId: "p1",
          email: "a@b.com",
          triggerId: null,
        });
        await service.suppress({
          projectId: "p2",
          email: "c@d.com",
          triggerId: null,
        });
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
        expect(
          await service.getAllForProject({ projectId: "p1" }),
        ).toHaveLength(0);
      });
    });
  });

  describe("given a trigger-scoped and a project-wide suppression", () => {
    beforeEach(async () => {
      await service.suppress({
        projectId: "p1",
        email: "trigger@x.com",
        triggerId: "t1",
      });
      await service.suppress({
        projectId: "p1",
        email: "project@x.com",
        triggerId: null,
      });
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

    describe("when getAllEnriched is called", () => {
      it("attaches the trigger name to rows with a triggerId", async () => {
        const rows = await service.getAllEnriched({ projectId: "p1" });
        const triggerRow = rows.find((r) => r.triggerId === "t1");
        const projectRow = rows.find((r) => r.triggerId === null);
        expect(triggerRow?.triggerName).toBe("Trigger Alpha");
        expect(projectRow?.triggerName).toBeNull();
      });
    });
  });

  describe("given lookupNames is called", () => {
    describe("when the project exists and has a trigger", () => {
      it("returns the project and trigger display names", async () => {
        const result = await service.lookupNames({
          projectId: "p1",
          triggerId: "t1",
        });
        expect(result).toEqual({
          projectName: "Project One",
          triggerName: "Trigger Alpha",
        });
      });
    });

    describe("when the triggerId is null (project-wide scope)", () => {
      it("returns the project name with a null trigger name", async () => {
        const result = await service.lookupNames({
          projectId: "p1",
          triggerId: null,
        });
        expect(result).toEqual({
          projectName: "Project One",
          triggerName: null,
        });
      });
    });

    describe("when the project does not exist", () => {
      it("returns null", async () => {
        const result = await service.lookupNames({
          projectId: "unknown-project",
          triggerId: null,
        });
        expect(result).toBeNull();
      });
    });
  });

  describe("given an unsubscribe token is resolved for display", () => {
    describe("when the token is valid and the project exists", () => {
      it("returns the masked email with project and trigger names", async () => {
        const token = signUnsubscribeToken({
          projectId: "p1",
          triggerId: "t1",
          email: "alice@example.com",
        });
        const view = await service.resolveUnsubscribeView({ token });
        expect(view).toEqual({
          projectName: "Project One",
          triggerName: "Trigger Alpha",
          email: "a***@example.com",
        });
      });
    });

    describe("when the token is tampered", () => {
      it("returns null", async () => {
        const view = await service.resolveUnsubscribeView({
          token: "garbage.sig",
        });
        expect(view).toBeNull();
      });
    });

    describe("when the token's project no longer exists", () => {
      it("returns null", async () => {
        const token = signUnsubscribeToken({
          projectId: "deleted-project",
          triggerId: null,
          email: "alice@example.com",
        });
        const view = await service.resolveUnsubscribeView({ token });
        expect(view).toBeNull();
      });
    });
  });

  describe("given an unsubscribe is confirmed via token", () => {
    describe("when the scope is trigger", () => {
      it("records a trigger-scoped suppression with the unsubscribe reason", async () => {
        const token = signUnsubscribeToken({
          projectId: "p1",
          triggerId: "t1",
          email: "alice@example.com",
        });
        await service.confirmUnsubscribe({ token, scope: "trigger" });
        expect(repo.rows).toEqual([
          expect.objectContaining({
            projectId: "p1",
            triggerId: "t1",
            email: "alice@example.com",
            reason: "unsubscribe",
          }),
        ]);
      });
    });

    describe("when the scope is project", () => {
      it("records a project-wide suppression (null triggerId)", async () => {
        const token = signUnsubscribeToken({
          projectId: "p1",
          triggerId: "t1",
          email: "alice@example.com",
        });
        await service.confirmUnsubscribe({ token, scope: "project" });
        expect(repo.rows).toEqual([
          expect.objectContaining({
            projectId: "p1",
            triggerId: null,
            reason: "unsubscribe",
          }),
        ]);
      });
    });

    describe("when the token is tampered", () => {
      it("throws InvalidUnsubscribeTokenError without persisting", async () => {
        await expect(
          service.confirmUnsubscribe({
            token: "garbage.sig",
            scope: "trigger",
          }),
        ).rejects.toBeInstanceOf(InvalidUnsubscribeTokenError);
        expect(repo.rows).toEqual([]);
      });
    });
  });
});
