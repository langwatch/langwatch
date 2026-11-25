import { describe, expect, it } from "vitest";

import { readSecretReference } from "../http-node.ts";

describe("readSecretReference", () => {
  describe("given a bare reference", () => {
    /** @scenario "A credential's reference is read from its value" */
    it("reads the secret name", () => {
      expect(readSecretReference("{{ secrets.HTTP_AGENT_TOKEN }}")).toEqual({
        isReference: true,
        name: "HTTP_AGENT_TOKEN",
      });
    });
  });

  describe("given a reference after a scheme", () => {
    /** @scenario "A credential's reference is read from its value" */
    it.each(["Bearer", "Basic", "Token"])("returns the name after %s", (scheme) => {
      expect(readSecretReference(`${scheme} {{ secrets.API_KEY_2 }}`)).toEqual({
        isReference: true,
        name: "API_KEY_2",
      });
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
    ])("reads %j as no reference", (value) => {
      expect(readSecretReference(value)).toEqual({ isReference: false });
    });
  });
});
