import { describe, expect, it } from "vitest";

import { secretReferenceOf } from "../http-node.ts";

describe("secretReferenceOf", () => {
  describe("given a bare reference", () => {
    /** @scenario "A credential's reference is read from its value" */
    it("returns the secret name", () => {
      expect(secretReferenceOf("{{ secrets.HTTP_AGENT_TOKEN }}")).toBe("HTTP_AGENT_TOKEN");
    });
  });

  describe("given a reference after a scheme", () => {
    /** @scenario "A credential's reference is read from its value" */
    it.each(["Bearer", "Basic", "Token"])("returns the name after %s", (scheme) => {
      expect(secretReferenceOf(`${scheme} {{ secrets.API_KEY_2 }}`)).toBe("API_KEY_2");
    });
  });

  describe("given anything else", () => {
    /** @scenario "A credential's reference is read from its value" */
    it.each([
      "",
      "sk-live-123",
      "Bearer sk-live-123",
      "Digest {{ secrets.API_KEY }}",
      "{{ secrets.api_key }}",
      "{{secrets.API_KEY}}",
      "{{ secrets.API_KEY }} extra",
      "prefix {{ secrets.API_KEY }}",
    ])("returns nothing for %j", (value) => {
      expect(secretReferenceOf(value)).toBeUndefined();
    });
  });
});
