import { describe, expect, it } from "vitest";

import {
  defineMigrationStep,
  isDeclaredMigrationStep,
  MigrationStepDeclarationError,
} from "../migration-step.ts";

const run = async () => ({});

describe("defineMigrationStep finishBy", () => {
  describe("given a background step naming the release it must finish by", () => {
    it("carries the release on the declared step", () => {
      const step = defineMigrationStep({
        id: "evaluation:copy-inputs",
        kind: "data",
        mode: "background",
        description: "Copies evaluation inputs.",
        finishBy: "3.24.0",
        run,
      });

      expect(step.finishBy).toBe("3.24.0");
    });
  });

  describe("given an operator step naming a finishBy release", () => {
    it("refuses it by name", () => {
      const declare = () =>
        defineMigrationStep({
          id: "storage:move-blobs",
          kind: "procedure",
          mode: "operator",
          description: "Moves blobs to object storage.",
          finishBy: "3.24.0",
          run,
        });

      expect(declare).toThrow(MigrationStepDeclarationError);
      expect(declare).toThrow(/finishBy 3\.24\.0/);
    });
  });

  describe("given a finishBy that is not a release", () => {
    it("refuses the declaration", () => {
      const declare = () =>
        defineMigrationStep({
          id: "evaluation:copy-inputs",
          kind: "data",
          mode: "background",
          description: "Copies evaluation inputs.",
          finishBy: "next",
          run,
        });

      expect(declare).toThrow(/Invalid string/);
    });
  });
});

describe("isDeclaredMigrationStep", () => {
  it("accepts a run step and a tenant step and refuses anything else", () => {
    const data = defineMigrationStep({
      id: "evaluation:copy-inputs",
      kind: "data",
      mode: "background",
      description: "Copies evaluation inputs.",
      run,
    });
    const tenant = defineMigrationStep({
      id: "prompt:seed-default-tags",
      kind: "tenant",
      mode: "background",
      description: "Seeds the default prompt tags into every organization.",
      tenants: "organization",
      title: "Default prompt tags",
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
      migrateTenant: async () => ({ status: "finalized" }),
    });

    expect([data, tenant, { id: "prompt:x" }].map(isDeclaredMigrationStep)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
