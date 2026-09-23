/**
 * The scope port's own defaults, which a screen depends on being loud.
 */

import { describe, expect, it } from "vitest";

import { UiCapabilityUnavailableError, UNAVAILABLE_UI_SCOPE } from "../capabilities.ts";
import { UiScope } from "../scope.ts";

class SomewhereScope extends UiScope {
  activeScope() {
    return { organizationId: "org-acme", projectId: "proj-app" };
  }
}

describe("given a composition that named no scope source", () => {
  describe("when a screen asks where it is standing", () => {
    it("refuses by name rather than answering an organization of null", () => {
      expect(() => UNAVAILABLE_UI_SCOPE.activeScope()).toThrow(UiCapabilityUnavailableError);
      expect(() => UNAVAILABLE_UI_SCOPE.activeScope()).toThrow(
        /"scope" UI capability has no implementation/,
      );
    });
  });

  describe("when a cross-feature component reads the shared scope host", () => {
    it("reads nothing rather than throwing, so the component stays alive", () => {
      expect(UNAVAILABLE_UI_SCOPE.scopeHost()).toBeUndefined();
    });
  });
});

describe("given a scope port a composition did answer", () => {
  describe("when a screen asks where it is standing", () => {
    it("answers with the organization and project the page is about", () => {
      expect(new SomewhereScope().activeScope()).toEqual({
        organizationId: "org-acme",
        projectId: "proj-app",
      });
    });
  });
});
