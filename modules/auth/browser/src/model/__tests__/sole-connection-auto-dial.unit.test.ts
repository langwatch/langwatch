/**
 * The loop breaker for the self-hosted sole-connection redirect.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberSoleConnectionAutoDial,
  SOLE_CONNECTION_REDIAL_WINDOW_MS,
  soleConnectionAutoDialAllowed,
} from "../sole-connection-auto-dial.ts";

const STORAGE_KEY = "langwatch.signin.soleConnectionDialedAt";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("SecurityError: storage is blocked");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

describe("soleConnectionAutoDial", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when this tab never dialed", () => {
    /** @scenario "A self-hosted sign-in page goes straight to the sole live connection" */
    it("allows the automatic dial", () => {
      expect(soleConnectionAutoDialAllowed(1_000)).toBe(true);
    });
  });

  describe("when this tab dialed moments ago", () => {
    /** @scenario "The sole connection is not dialed twice in a row" */
    it("refuses a second automatic dial inside the window", () => {
      rememberSoleConnectionAutoDial(10_000);

      expect(soleConnectionAutoDialAllowed(10_000)).toBe(false);
      expect(soleConnectionAutoDialAllowed(10_000 + SOLE_CONNECTION_REDIAL_WINDOW_MS - 1)).toBe(
        false,
      );
    });

    /** @scenario "The sole connection is not dialed twice in a row" */
    it("allows it again once the window has passed", () => {
      rememberSoleConnectionAutoDial(10_000);

      expect(soleConnectionAutoDialAllowed(10_000 + SOLE_CONNECTION_REDIAL_WINDOW_MS)).toBe(true);
    });
  });

  describe("when the stored value is not a timestamp", () => {
    /** @scenario "A self-hosted sign-in page goes straight to the sole live connection" */
    it("allows the automatic dial", () => {
      storage.setItem(STORAGE_KEY, "not-a-number");

      expect(soleConnectionAutoDialAllowed(10_000)).toBe(true);
    });
  });

  describe("when storage throws", () => {
    beforeEach(() => {
      vi.stubGlobal("window", { sessionStorage: throwingStorage() });
    });

    /** @scenario "A self-hosted sign-in page goes straight to the sole live connection" */
    it("allows the automatic dial and remembering it does not throw", () => {
      expect(() => rememberSoleConnectionAutoDial(10_000)).not.toThrow();
      expect(soleConnectionAutoDialAllowed(10_000)).toBe(true);
    });
  });
});
