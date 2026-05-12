import { describe, expect, it, vi } from "vitest";
import {
  LangyUserPreferencesRepository,
  LangyUserPreferencesService,
} from "../LangyUserPreferencesService";

function makeService() {
  const repo = {
    findById: vi.fn(),
    upsert: vi.fn(),
    deleteByUserAndProject: vi.fn(),
  } as unknown as LangyUserPreferencesRepository;
  return { service: new LangyUserPreferencesService(repo), repo };
}

describe("LangyUserPreferencesService", () => {
  describe("when getById is called for a user with no row", () => {
    it("creates a default-mode row", async () => {
      const { service, repo } = makeService();
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (repo.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "u1",
        projectId: "p1",
        mode: "non_expert",
        dismissedSuggestionKinds: [],
      });
      const prefs = await service.getById({ userId: "u1", projectId: "p1" });
      expect(prefs.mode).toBe("non_expert");
      expect(repo.upsert).toHaveBeenCalledWith({
        userId: "u1",
        projectId: "p1",
      });
    });
  });

  describe("when setMode is called", () => {
    it("upserts the new mode", async () => {
      const { service, repo } = makeService();
      (repo.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "u1",
        projectId: "p1",
        mode: "expert",
      });
      await service.setMode({
        userId: "u1",
        projectId: "p1",
        mode: "expert",
      });
      expect(repo.upsert).toHaveBeenCalledWith({
        userId: "u1",
        projectId: "p1",
        mode: "expert",
      });
    });
  });

  describe("mode is scoped per project — binds langy-baseline.feature § Mode is scoped per project", () => {
    // Drive the real repository against an in-memory fake Prisma so we
    // actually prove projectId isolation rather than just trusting the mock.
    function makeRepository() {
      type Row = {
        id: string;
        userId: string;
        projectId: string;
        mode: "non_expert" | "expert";
        dismissedSuggestionKinds: string[];
      };
      const rows: Row[] = [];
      let nextId = 1;
      const prisma = {
        langyUserPreferences: {
          findFirst: async ({
            where,
          }: {
            where: { userId?: string; projectId?: string; id?: string };
          }) => {
            return (
              rows.find(
                (r) =>
                  (where.userId === undefined || r.userId === where.userId) &&
                  (where.projectId === undefined ||
                    r.projectId === where.projectId) &&
                  (where.id === undefined || r.id === where.id),
              ) ?? null
            );
          },
          create: async ({ data }: { data: Omit<Row, "id"> }) => {
            const row: Row = { id: `p${nextId++}`, ...data };
            rows.push(row);
            return row;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; projectId: string };
            data: Partial<Row>;
          }) => {
            const target = rows.find(
              (r) => r.id === where.id && r.projectId === where.projectId,
            );
            if (target) Object.assign(target, data);
            return { count: target ? 1 : 0 };
          },
          deleteMany: async ({
            where,
          }: {
            where: { userId: string; projectId: string };
          }) => {
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              const r = rows[i]!;
              if (
                r.userId === where.userId &&
                r.projectId === where.projectId
              ) {
                rows.splice(i, 1);
              }
            }
            return { count: before - rows.length };
          },
        },
      };
      return new LangyUserPreferencesRepository(
        prisma as unknown as Parameters<
          typeof LangyUserPreferencesRepository.prototype.findById
        >[0] extends unknown
          ? never
          : never,
      );
    }

    it("does not leak a mode set in one project into another project for the same user", async () => {
      const repo = makeRepository();
      const service = new LangyUserPreferencesService(repo);

      await service.setMode({ userId: "u1", projectId: "p1", mode: "expert" });

      const p1 = await service.getById({ userId: "u1", projectId: "p1" });
      const p2 = await service.getById({ userId: "u1", projectId: "p2" });

      expect(p1.mode).toBe("expert");
      expect(p2.mode).toBe("non_expert");
    });

    it("does not leak across users in the same project", async () => {
      const repo = makeRepository();
      const service = new LangyUserPreferencesService(repo);

      await service.setMode({ userId: "u1", projectId: "p1", mode: "expert" });

      const u1 = await service.getById({ userId: "u1", projectId: "p1" });
      const u2 = await service.getById({ userId: "u2", projectId: "p1" });

      expect(u1.mode).toBe("expert");
      expect(u2.mode).toBe("non_expert");
    });
  });
});
