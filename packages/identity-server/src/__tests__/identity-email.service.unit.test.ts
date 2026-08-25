import { describe, expect, it, vi } from "vitest";
import { IdentityEmailService } from "../identity-email.service";
import { fact, InMemoryHeads, USER } from "./support/in-memory-heads";

function harness(options?: { onIdentity?: boolean }) {
  const heads = new InMemoryHeads();
  heads.heads.set(USER, {
    userId: USER,
    identifiers: {
      idf_primary: fact({
        identifierId: "idf_primary",
        value: "chosen@acme.com",
        state: "PRIMARY",
      }),
    },
  });
  const service = new IdentityEmailService(
    heads,
    async () => options?.onIdentity ?? true,
  );
  return { service, heads };
}

describe("the identity email read fork", () => {
  describe("given a user whose backfill is finalized", () => {
    /** @scenario "The legacy email field answers from the identifiers" */
    it("answers from the identifiers", async () => {
      const { service } = harness();

      expect(await service.resolveEmail({ userId: USER })).toBe(
        "chosen@acme.com",
      );
    });
  });

  describe("given a user whose backfill is not finalized", () => {
    /** @scenario "An unmigrated user keeps the legacy email column" */
    it("answers null without reading the projection at all", async () => {
      const { service, heads } = harness({ onIdentity: false });
      const findHeads = vi.spyOn(heads, "findHeads");

      expect(await service.resolveEmail({ userId: USER })).toBeNull();
      expect(findHeads).not.toHaveBeenCalled();
    });
  });

  describe("when the projection cannot be read", () => {
    /** @scenario "An unreadable projection never fails a request" */
    it("answers null rather than throwing into the session boundary", async () => {
      const { service, heads } = harness();
      vi.spyOn(heads, "findHeads").mockRejectedValue(
        new Error("postgres unavailable"),
      );

      expect(await service.resolveEmail({ userId: USER })).toBeNull();
    });
  });

  describe("when the gate itself cannot be read", () => {
    it("answers null: a read fork must never break sign-in", async () => {
      const heads = new InMemoryHeads();
      const service = new IdentityEmailService(heads, async () => {
        throw new Error("migration state unavailable");
      });

      expect(await service.resolveEmail({ userId: USER })).toBeNull();
    });
  });
});
