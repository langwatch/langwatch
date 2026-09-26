import { describe, expect, it } from "vitest";

import { queryCapabilityOf } from "../query-capability";

describe("queryCapabilityOf", () => {
  describe("given a project with a query key", () => {
    const project = { id: "project-1", lwqlKey: "lwql-key" };

    describe("when the deployment has a LangWatchQL identity", () => {
      it("answers the project's capability", () => {
        expect(
          queryCapabilityOf({ project, hasDeploymentIdentity: true }),
        ).toEqual({ id: "project-1", lwqlKey: "lwql-key" });
      });
    });

    describe("when the deployment has no LangWatchQL identity", () => {
      /** @scenario "A deployment with no query identity answers as not enabled" */
      it("answers no capability, which the run service refuses as not enabled", () => {
        expect(
          queryCapabilityOf({ project, hasDeploymentIdentity: false }),
        ).toBeNull();
      });
    });
  });

  describe("given a project with no query key", () => {
    it("answers no capability", () => {
      expect(
        queryCapabilityOf({
          project: { id: "project-1", lwqlKey: null },
          hasDeploymentIdentity: true,
        }),
      ).toBeNull();
    });
  });
});
