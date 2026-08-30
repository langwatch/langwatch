/**
 * Unit coverage for the one policy decision the service makes on its own: a
 * stored value the platform can no longer open reads as a miss.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCacheRepository } from "../agent-cache.repository";
import { AgentCacheService } from "../agent-cache.service";

vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("sealed:")) {
      throw new Error("this envelope does not open with the current key");
    }
    return value.slice("sealed:".length);
  },
}));

describe("AgentCacheService", () => {
  let service: AgentCacheService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AgentCacheService();
  });

  describe("given an entry written with the key the platform still holds", () => {
    describe("when the caller reads it", () => {
      it("answers the value", async () => {
        await service.put({
          projectId: "project_1",
          name: "ACME_SESSION",
          value: "session-1",
        });

        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_SESSION" }),
        ).resolves.toEqual({ name: "ACME_SESSION", value: "session-1" });
      });
    });
  });

  describe("given an entry the platform can no longer open", () => {
    describe("when the caller reads it", () => {
      /** @scenario "An entry the platform can no longer read answers as a miss" */
      it("answers as a miss rather than as a failure", async () => {
        vi.spyOn(
          AgentCacheRepository.prototype,
          "findByName",
        ).mockResolvedValue("written-with-a-key-that-is-gone");

        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_SESSION" }),
        ).rejects.toMatchObject({ code: "cache_entry_not_found" });
      });

      /** @scenario "An entry the platform can no longer read answers as a miss" */
      it("keeps the stored value out of the log line", async () => {
        vi.spyOn(
          AgentCacheRepository.prototype,
          "findByName",
        ).mockResolvedValue("a-secret-nobody-may-log");
        // The logger writes to stdout, so that is where the assertion has to
        // look: a spy on `console` would pass without reading a line.
        const written: string[] = [];
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
          written.push(String(chunk));
          return true;
        });

        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_SESSION" }),
        ).rejects.toMatchObject({ code: "cache_entry_not_found" });

        expect(written.join("")).toContain("ACME_SESSION");
        expect(written.join("")).not.toContain("a-secret-nobody-may-log");
      });
    });
  });

  describe("given a name the project does not hold", () => {
    describe("when the caller reads it", () => {
      it("answers as a miss", async () => {
        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_ABSENT" }),
        ).rejects.toMatchObject({ code: "cache_entry_not_found" });
      });
    });
  });
});
