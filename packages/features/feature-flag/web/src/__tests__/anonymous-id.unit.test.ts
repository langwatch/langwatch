/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAnonymousId } from "../anonymous-id";

const STORAGE_KEY = "langwatch:anonymous-id";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("readAnonymousId", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("given no id has been stored", () => {
    it("mints a v4 UUID", () => {
      expect(readAnonymousId()).toMatch(UUID_V4);
    });

    it("persists it so the next read returns the same id", () => {
      const first = readAnonymousId();

      expect(readAnonymousId()).toBe(first);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(first);
    });

    it("stores the id and nothing else", () => {
      readAnonymousId();

      expect(Object.keys(localStorage)).toEqual([STORAGE_KEY]);
    });
  });

  describe("given storage was cleared", () => {
    it("rotates to a different id", () => {
      const first = readAnonymousId();
      localStorage.clear();

      expect(readAnonymousId()).not.toBe(first);
    });
  });

  describe("given a stored value that is not a v4 UUID", () => {
    it("replaces it rather than trusting it", () => {
      localStorage.setItem(STORAGE_KEY, "../../etc/passwd");

      const id = readAnonymousId();

      expect(id).toMatch(UUID_V4);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
    });
  });

  describe("given localStorage throws", () => {
    it("still returns an id, stable for the page", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("site data blocked");
      });

      const first = readAnonymousId();

      expect(first).toMatch(UUID_V4);
      expect(readAnonymousId()).toBe(first);
    });
  });
});
