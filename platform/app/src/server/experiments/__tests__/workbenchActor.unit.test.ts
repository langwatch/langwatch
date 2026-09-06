/**
 * @vitest-environment node
 *
 * Attribution of a REST write to an actor.
 *
 * The create endpoint and the workbench endpoints share this rule, so the same
 * key has to read the same way on both. That is what these cases pin.
 */
import { describe, expect, it } from "vitest";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { workbenchActorFrom } from "../workbenchActor";

const apiKeyToken = (
  overrides: Partial<Extract<ResolvedToken, { type: "apiKey" }>> = {},
): ResolvedToken =>
  ({
    type: "apiKey",
    apiKeyId: "key-1",
    userId: null,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: {},
    ...overrides,
  }) as ResolvedToken;

describe("workbenchActorFrom", () => {
  describe("when the key is the one a Langy chat minted for itself", () => {
    it("attributes the write to Langy", () => {
      expect(
        workbenchActorFrom({
          resolved: apiKeyToken({ isLangySessionKey: true }),
        }),
      ).toEqual({ label: "langy" });
    });
  });

  describe("when the key belongs to a person", () => {
    it("names the person alongside the integration label", () => {
      expect(
        workbenchActorFrom({ resolved: apiKeyToken({ userId: "user-1" }) }),
      ).toEqual({ label: "api", userId: "user-1" });
    });
  });

  describe("when the key has no user", () => {
    it("attributes the write to an integration", () => {
      expect(workbenchActorFrom({ resolved: apiKeyToken() })).toEqual({
        label: "api",
      });
    });
  });

  describe("when the credential is a legacy project key", () => {
    it("attributes the write to an integration", () => {
      expect(
        workbenchActorFrom({
          resolved: { type: "legacyProjectKey", project: {} } as ResolvedToken,
        }),
      ).toEqual({ label: "api" });
    });
  });

  describe.each([
    { label: "null", resolved: null },
    { label: "undefined", resolved: undefined },
  ])("when the resolved token is $label", ({ resolved }) => {
    it("attributes the write to an integration", () => {
      expect(workbenchActorFrom({ resolved })).toEqual({ label: "api" });
    });
  });
});
