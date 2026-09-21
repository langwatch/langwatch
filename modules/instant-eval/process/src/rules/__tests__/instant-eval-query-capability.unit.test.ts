/**
 * What a run executes its statement as, and when there is nothing to execute
 * it as at all.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { InstantEvalNotEnabledError } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import { getInstantEvalQueryCapability } from "../instant-eval-query-capability.rules.ts";

describe("getInstantEvalQueryCapability", () => {
  describe("given a project with a query key", () => {
    const project = { id: "project-1", lwqlKey: "lwql-key" };

    describe("when the deployment has a LangWatchQL identity", () => {
      it("answers the project's capability", () => {
        expect(getInstantEvalQueryCapability({ project, hasDeploymentIdentity: true })).toEqual({
          id: "project-1",
          lwqlKey: "lwql-key",
        });
      });
    });

    describe("when the deployment has no LangWatchQL identity", () => {
      it("refuses as not enabled, rather than failing later in the row source", () => {
        expect(() =>
          getInstantEvalQueryCapability({ project, hasDeploymentIdentity: false }),
        ).toThrow(InstantEvalNotEnabledError);
      });
    });
  });

  describe("given a project with no query key", () => {
    it("refuses as not enabled", () => {
      expect(() =>
        getInstantEvalQueryCapability({
          project: { id: "project-1", lwqlKey: null },
          hasDeploymentIdentity: true,
        }),
      ).toThrow(InstantEvalNotEnabledError);
    });
  });

  describe("given no project at all", () => {
    it("refuses as not enabled", () => {
      expect(() =>
        getInstantEvalQueryCapability({ project: null, hasDeploymentIdentity: true }),
      ).toThrow(InstantEvalNotEnabledError);
    });
  });
});
