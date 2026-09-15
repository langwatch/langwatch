import { describe, expect, it } from "vitest";
import { API_KEY_PEPPER_KEYS, apiKeyPepperFrom } from "../api-key-pepper.ts";

describe("given the environment the seed resolved", () => {
  describe("when it carries CREDENTIALS_SECRET", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("uses it as the pepper", () => {
      expect(apiKeyPepperFrom({ environment: { CREDENTIALS_SECRET: "pepper-a" } })).toEqual({
        pepper: "pepper-a",
        absent: [],
      });
    });
  });

  describe("when it carries only NEXTAUTH_SECRET", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("falls back to it", () => {
      expect(apiKeyPepperFrom({ environment: { NEXTAUTH_SECRET: "pepper-b" } })).toEqual({
        pepper: "pepper-b",
        absent: [],
      });
    });
  });

  describe("when it carries both", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("prefers CREDENTIALS_SECRET, the name the applications read first", () => {
      expect(
        apiKeyPepperFrom({
          environment: { CREDENTIALS_SECRET: "pepper-a", NEXTAUTH_SECRET: "pepper-b" },
        }).pepper,
      ).toBe("pepper-a");
    });
  });

  describe("when it carries neither", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("names the keys it looked for instead of throwing", () => {
      expect(apiKeyPepperFrom({ environment: {} })).toEqual({
        pepper: undefined,
        absent: API_KEY_PEPPER_KEYS,
      });
    });

    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("treats an empty value as absent, not as a pepper", () => {
      expect(apiKeyPepperFrom({ environment: { CREDENTIALS_SECRET: "" } }).pepper).toBeUndefined();
    });
  });
});
