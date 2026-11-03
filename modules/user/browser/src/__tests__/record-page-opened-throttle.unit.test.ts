/**
 * @vitest-environment node
 * The browser sends at most one page-opened mutation an hour per page from one tab's storage.
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import { describe, expect, it } from "vitest";

import { recordPageOpenedOncePerHour } from "../behavior/use-record-page-opened.ts";

const HOUR = 60 * 60 * 1000;

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function opener(storage: Pick<Storage, "getItem" | "setItem"> = memoryStorage()) {
  const sent: string[] = [];
  const open = (now: number) =>
    recordPageOpenedOncePerHour({
      page: "me_sessions",
      storage,
      now: () => now,
      send: async (page) => void sent.push(page),
    });
  return { open, sent };
}

describe("recordPageOpenedOncePerHour", () => {
  describe("when the page opens twice inside an hour", () => {
    /** @scenario "A refreshing tab sends one page-opened mutation an hour" */
    it("sends once", async () => {
      const { open, sent } = opener();

      await open(1_000);
      await open(1_000 + HOUR - 1);

      expect(sent).toEqual(["me_sessions"]);
    });
  });

  describe("when the page opens again after an hour", () => {
    it("sends again", async () => {
      const { open, sent } = opener();

      await open(1_000);
      await open(1_000 + HOUR + 1);

      expect(sent).toHaveLength(2);
    });
  });

  describe("when the storage throws", () => {
    it("still sends", async () => {
      const { open, sent } = opener({
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: () => {
          throw new Error("storage blocked");
        },
      });

      await open(1_000);

      expect(sent).toEqual(["me_sessions"]);
    });
  });

  describe("when the send fails", () => {
    it("resolves without throwing", async () => {
      await expect(
        recordPageOpenedOncePerHour({
          page: "me_sessions",
          storage: memoryStorage(),
          now: () => 1_000,
          send: async () => {
            throw new Error("offline");
          },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
