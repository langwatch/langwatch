import { ProjectNotFoundError } from "@langwatch/authorization";
import { isProjectGone } from "@langwatch/group-queue";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

/** Spec: specs/eventing/deleted-project-jobs.feature */

/** A handled refusal for anything other than a deleted project. */
class AccessRefused extends HandledError {
  constructor() {
    super("access_not_granted", "No grant", { httpStatus: 403 });
  }
}

/** Shaped as project's contract refusal: a handled error recognised by its code. */
class ProjectContractNotFound extends HandledError {
  constructor() {
    super("project_not_found", "Project not found", { httpStatus: 404 });
  }
}
const projectContractRefusal = () => new ProjectContractNotFound();

describe("isProjectGone", () => {
  describe("given either project-not-found error", () => {
    /** @scenario "A refusal from either project-not-found error is recognised, however it is wrapped" */
    it("recognises authorization's error and project's handled refusal directly", () => {
      expect(isProjectGone(new ProjectNotFoundError("project_gone"))).toBe(true);
      expect(isProjectGone(projectContractRefusal())).toBe(true);
    });

    /** @scenario "A refusal from either project-not-found error is recognised, however it is wrapped" */
    it("recognises one carried as the cause of another error", () => {
      const wrapped = new Error("fold failed", {
        cause: new Error("read failed", { cause: projectContractRefusal() }),
      });

      expect(isProjectGone(wrapped)).toBe(true);
    });

    /** @scenario "A refusal from either project-not-found error is recognised, however it is wrapped" */
    it("recognises an aggregate only when every member says the project is gone", () => {
      const gone = new ProjectNotFoundError("project_gone");

      expect(isProjectGone(new AggregateError([gone, projectContractRefusal()]))).toBe(true);
      expect(isProjectGone(new AggregateError([gone, new Error("timeout")]))).toBe(false);
      expect(isProjectGone(new AggregateError([]))).toBe(false);
    });
  });

  describe("given any other failure", () => {
    /** @scenario "A job that fails for any other reason is still retried" */
    it("does not recognise it", () => {
      expect(isProjectGone(new Error("clickhouse down"))).toBe(false);
      expect(isProjectGone(new AccessRefused())).toBe(false);
      expect(isProjectGone("project_not_found")).toBe(false);
      expect(isProjectGone(undefined)).toBe(false);
    });
  });
});
