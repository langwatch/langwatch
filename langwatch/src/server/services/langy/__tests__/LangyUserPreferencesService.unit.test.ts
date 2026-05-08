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
});
