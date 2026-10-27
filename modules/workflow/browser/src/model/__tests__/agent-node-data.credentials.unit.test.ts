import { describe, expect, it } from "vitest";

import { draftSettingsWithoutCredentials, withoutCredentialValues } from "../agent-node-data.ts";

describe("withoutCredentialValues", () => {
  describe("given a saved agent's headers and bearer auth", () => {
    /** @scenario "Saving a Studio node never sends credential values" */
    it("keeps the header names and the auth kind and blanks every value", () => {
      expect(
        withoutCredentialValues({
          headers: [{ key: "X-Api-Key", value: "acme" }],
          auth: { type: "bearer", token: "secret" },
        }),
      ).toEqual({
        headers: [{ key: "X-Api-Key", value: "" }],
        auth: { type: "bearer", token: "" },
      });
    });
  });

  describe("given an api key and a basic auth", () => {
    /** @scenario "Saving a Studio node never sends credential values" */
    it("blanks the key value and the password but keeps the names", () => {
      expect(
        withoutCredentialValues({
          headers: [],
          auth: { type: "api_key", header: "X-API-Key", value: "secret" },
        }).auth,
      ).toEqual({ type: "api_key", header: "X-API-Key", value: "" });
      expect(
        withoutCredentialValues({
          headers: [],
          auth: { type: "basic", username: "ana", password: "secret" },
        }).auth,
      ).toEqual({ type: "basic", username: "ana", password: "" });
    });
  });

  describe("given credentials that are references to project secrets", () => {
    /** @scenario "A saved agent's secret reference survives a Studio node save" */
    it("keeps the references and blanks the literals beside them", () => {
      expect(
        withoutCredentialValues({
          headers: [
            { key: "Authorization", value: "Bearer {{ secrets.HTTP_AGENT_AUTHORIZATION }}" },
            { key: "X-Api-Key", value: "acme" },
          ],
          auth: { type: "bearer", token: "{{ secrets.HTTP_AGENT_TOKEN }}" },
        }),
      ).toEqual({
        headers: [
          { key: "Authorization", value: "Bearer {{ secrets.HTTP_AGENT_AUTHORIZATION }}" },
          { key: "X-Api-Key", value: "" },
        ],
        auth: { type: "bearer", token: "{{ secrets.HTTP_AGENT_TOKEN }}" },
      });
    });
  });

  describe("given no auth", () => {
    it("stays without auth", () => {
      expect(withoutCredentialValues({ headers: [], auth: undefined }).auth).toBeUndefined();
    });
  });
});

describe("draftSettingsWithoutCredentials", () => {
  /** @scenario "Saving a Studio node never sends credential values" */
  it("drops the headers and auth keys and keeps the rest", () => {
    expect(
      draftSettingsWithoutCredentials({
        url: "https://example.test",
        headers: [{ key: "X", value: "secret" }],
        auth: { type: "bearer", token: "secret" },
      }),
    ).toEqual({ url: "https://example.test" });
  });

  it("stays undefined without settings", () => {
    expect(draftSettingsWithoutCredentials(undefined)).toBeUndefined();
  });
});
