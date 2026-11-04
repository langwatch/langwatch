import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetHeldAddressProof,
  HELD_ADDRESS_PROOF_MAX_AGE_MS,
  holdAddressProof,
  readHeldAddressProof,
  takeHeldAddressProofOnReload,
} from "../held-address-proof.ts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function refusingStorage(): Storage {
  const refuse = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

describe("given the held address proof", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when it is read within the proof's lifetime", () => {
    /** @scenario "The held proof lasts no longer than the proof itself" */
    it("answers the address and proof that were held", () => {
      holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1", now: 1_000 });

      expect(readHeldAddressProof({ now: 1_000 + HELD_ADDRESS_PROOF_MAX_AGE_MS })).toEqual({
        email: "sam@acme.com",
        addressProof: "proof-1",
      });
    });
  });

  describe("when it is read after the proof's lifetime", () => {
    /** @scenario "The held proof lasts no longer than the proof itself" */
    it("answers nothing and lets it go", () => {
      holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1", now: 1_000 });

      expect(readHeldAddressProof({ now: 1_001 + HELD_ADDRESS_PROOF_MAX_AGE_MS })).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
    });
  });

  describe("when it is forgotten", () => {
    it("answers nothing afterwards", () => {
      holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1" });
      forgetHeldAddressProof();

      expect(readHeldAddressProof()).toBeNull();
    });
  });

  describe("when what is stored is not a held proof", () => {
    it("answers nothing", () => {
      window.sessionStorage.setItem("langwatch.auth.signUpAddressProof", "{not json");

      expect(readHeldAddressProof()).toBeNull();
    });
  });

  describe("when the page arrived by a reload", () => {
    /** @scenario "A reload on the create-your-account step stays on it" */
    it("takes the held proof", () => {
      vi.stubGlobal("performance", { getEntriesByType: () => [{ type: "reload" }] });
      holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1" });

      expect(takeHeldAddressProofOnReload()).toEqual({
        email: "sam@acme.com",
        addressProof: "proof-1",
      });
    });
  });

  describe("when the page arrived by a fresh navigation", () => {
    /** @scenario "A fresh visit to sign-up starts at the address step" */
    it("takes nothing and lets the held proof go", () => {
      vi.stubGlobal("performance", { getEntriesByType: () => [{ type: "navigate" }] });
      holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1" });

      expect(takeHeldAddressProofOnReload()).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
    });
  });

  describe("when the browser refuses storage", () => {
    /** @scenario "The held proof lasts no longer than the proof itself" */
    it("holds nothing and throws nothing", () => {
      vi.stubGlobal("window", { sessionStorage: refusingStorage() });

      expect(() =>
        holdAddressProof({ email: "sam@acme.com", addressProof: "proof-1" }),
      ).not.toThrow();
      expect(readHeldAddressProof()).toBeNull();
      expect(() => forgetHeldAddressProof()).not.toThrow();
    });
  });
});
