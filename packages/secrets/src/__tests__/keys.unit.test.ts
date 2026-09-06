import { describe, expect, it } from "vitest";
import { classOf, COMPOSITE_KEYS, DEV_GENERATED_KEYS, SECRET_KEYS } from "../keys.ts";

describe("given the secret registry", () => {
  describe("when it is read", () => {
    /** @scenario "Every rotating credential is classified as a secret" */
    it("names twenty-nine secret keys and ten composite keys", () => {
      expect(SECRET_KEYS).toHaveLength(29);
      expect(COMPOSITE_KEYS).toHaveLength(10);
      expect(SECRET_KEYS).toContain("OPENAI_API_KEY");
      expect(COMPOSITE_KEYS).toContain("DATABASE_URL");
    });
  });

  describe("when the generate-on-first-run keys are read", () => {
    /** @scenario "Only the keys the generate scripts write are marked generate" */
    it("lists the gateway trio and the langy internal secret", () => {
      expect([...DEV_GENERATED_KEYS].sort()).toEqual([
        "LANGY_INTERNAL_SECRET",
        "LW_GATEWAY_INTERNAL_SECRET",
        "LW_GATEWAY_JWT_SECRET",
        "LW_VIRTUAL_KEY_PEPPER",
      ]);
    });
  });
});

describe("given a key the registry does not name", () => {
  describe("when its class is asked for", () => {
    /** @scenario "An unlisted key is configuration" */
    it("answers configuration", () => {
      expect(classOf({ key: "BASE_HOST" })).toBe("config");
      expect(classOf({ key: "GOOGLE_APPLICATION_CREDENTIALS" })).toBe("pointer");
    });
  });
});
