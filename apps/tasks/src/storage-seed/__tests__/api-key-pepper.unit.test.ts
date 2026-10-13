import { describe, expect, it } from "vitest";

import { API_KEY_PEPPER_KEYS, apiKeyPepperFrom } from "../api-key-pepper.ts";

describe("given the environment the seed resolved", () => {
  describe("when it carries API_KEY_PEPPER", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("uses it as the pepper", () => {
      expect(apiKeyPepperFrom({ environment: { API_KEY_PEPPER: "pepper-a" } })).toEqual({
        pepper: "pepper-a",
        absent: [],
      });
    });
  });

  describe("when it carries only CREDENTIALS_SECRET", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("hashes under it, as the application's chain does", () => {
      expect(
        apiKeyPepperFrom({
          environment: { CREDENTIALS_SECRET: "credentials", NEXTAUTH_SECRET: "session" },
        }).pepper,
      ).toBe("credentials");
    });
  });

  describe("when it carries only NEXTAUTH_SECRET", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("hashes under the last link of the chain", () => {
      expect(apiKeyPepperFrom({ environment: { NEXTAUTH_SECRET: "session" } }).pepper).toBe(
        "session",
      );
    });
  });

  describe("when it carries API_KEY_PEPPER and the fallbacks", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("prefers API_KEY_PEPPER", () => {
      expect(
        apiKeyPepperFrom({ environment: { API_KEY_PEPPER: "pepper-a", CREDENTIALS_SECRET: "c" } })
          .pepper,
      ).toBe("pepper-a");
    });
  });

  describe("when it carries none of the chain", () => {
    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("names the keys it looked for instead of throwing", () => {
      expect(apiKeyPepperFrom({ environment: {} })).toEqual({
        pepper: undefined,
        absent: API_KEY_PEPPER_KEYS,
      });
    });

    /** @scenario "A seed with no API-key pepper still seeds the local identity" */
    it("treats an empty value as absent, not as a pepper", () => {
      expect(apiKeyPepperFrom({ environment: { API_KEY_PEPPER: "" } }).pepper).toBeUndefined();
    });
  });
});
