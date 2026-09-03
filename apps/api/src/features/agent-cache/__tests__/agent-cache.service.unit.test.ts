/**
 * Unit coverage for the one policy decision the service makes on its own: a
 * stored value the platform can no longer open reads as a miss.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import { AgentCacheEntryStorePort } from "../agent-cache.repository";
import { AgentCacheService } from "../agent-cache.service";

class InMemoryStore extends AgentCacheEntryStorePort {
  private readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async claim(key: string, value: string): Promise<boolean> {
    if (this.entries.has(key)) return false;
    this.entries.set(key, value);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

const fakeEncryption: SecretEncryptionPort = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("sealed:")) {
      throw new Error("this envelope does not open with the current key");
    }
    return value.slice("sealed:".length);
  },
};

describe("AgentCacheService", () => {
  let store: InMemoryStore;
  let service: AgentCacheService;

  beforeEach(() => {
    vi.restoreAllMocks();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();
    store = new InMemoryStore();
    service = new AgentCacheService(store, fakeEncryption);
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
        vi.spyOn(store, "get").mockResolvedValue("written-with-a-key-that-is-gone");

        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_SESSION" }),
        ).rejects.toMatchObject({ code: "cache_entry_not_found" });
      });

      /** @scenario "An entry the platform can no longer read answers as a miss" */
      it("keeps the stored value out of the log line", async () => {
        vi.spyOn(store, "get").mockResolvedValue("a-secret-nobody-may-log");

        await expect(
          service.getByName({ projectId: "project_1", name: "ACME_SESSION" }),
        ).rejects.toMatchObject({ code: "cache_entry_not_found" });

        const written = JSON.stringify(logger.warn.mock.calls);
        expect(written).toContain("ACME_SESSION");
        expect(written).not.toContain("a-secret-nobody-may-log");
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
