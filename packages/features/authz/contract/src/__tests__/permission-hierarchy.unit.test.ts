/**
 * The manage-implication rule, which is the whole of the legacy
 * `hasPermissionWithHierarchy` contract: every role bag, every custom role
 * and every `useCan` call reaches a verdict through this one function.
 * Spec: packages/features/authz/specs/permission-resolution.feature
 */
import { describe, expect, it } from "vitest";
import { permissionSatisfiedBy } from "../registry.ts";

const satisfies = (granted: readonly string[], requested: string): boolean =>
  permissionSatisfiedBy({ granted: new Set(granted), requested });

describe("given a bag of granted permissions", () => {
  describe("when the requested permission is in the bag", () => {
    /** @scenario "A direct grant satisfies its own request" */
    it.concurrent("satisfies it directly", () => {
      expect(satisfies(["workflows:view", "datasets:manage"], "workflows:view")).toBe(true);
      expect(satisfies(["workflows:view", "datasets:manage"], "datasets:manage")).toBe(true);
    });
  });

  describe("when the bag holds manage on the requested resource", () => {
    /** @scenario "A manage grant satisfies the read and write actions on its resource" */
    it.concurrent("satisfies view, create, update and delete on that resource", () => {
      for (const action of ["view", "create", "update", "delete"]) {
        expect(satisfies(["workflows:manage"], `workflows:${action}`)).toBe(true);
      }
    });

    /** @scenario "A manage grant satisfies the read and write actions on its resource" */
    it.concurrent("satisfies the manage request itself", () => {
      expect(satisfies(["workflows:manage"], "workflows:manage")).toBe(true);
    });

    /** @scenario "A grant on one resource never reaches another" */
    it.concurrent("does not reach a different resource", () => {
      expect(satisfies(["datasets:manage"], "workflows:view")).toBe(false);
      expect(satisfies(["datasets:manage"], "workflows:manage")).toBe(false);
    });
  });

  describe("when the bag holds only view on the requested resource", () => {
    /** @scenario "A view grant never satisfies manage" */
    it.concurrent("refuses manage — the implication runs one way only", () => {
      expect(satisfies(["workflows:view"], "workflows:view")).toBe(true);
      expect(satisfies(["workflows:view"], "workflows:manage")).toBe(false);
    });
  });

  describe("when the bag is empty", () => {
    /** @scenario "An empty permission bag satisfies nothing" */
    it.concurrent("satisfies nothing", () => {
      expect(satisfies([], "workflows:view")).toBe(false);
      expect(satisfies([], "workflows:manage")).toBe(false);
    });
  });

  describe("when the resource has no manage action at all", () => {
    /** @scenario "Sharing a trace is not implied by any manage grant" */
    it.concurrent("grants traces:share directly and never widens it to a read", () => {
      expect(satisfies(["traces:share"], "traces:share")).toBe(true);
      expect(satisfies(["traces:share"], "traces:view")).toBe(false);
    });

    /** @scenario "Sharing a trace is not implied by any manage grant" */
    it.concurrent("cannot be reached through a manage grant that no bag issues", () => {
      expect(satisfies(["triggers:manage"], "triggers:view")).toBe(true);
      expect(satisfies(["traces:manage"], "traces:share")).toBe(false);
    });
  });

  describe("when the requested string is malformed", () => {
    /** @scenario "A malformed permission request matches nothing" */
    it.concurrent("refuses a bare resource, a bare action and an empty action", () => {
      expect(satisfies(["workflows:manage"], "workflows:")).toBe(false);
      expect(satisfies(["workflows:manage"], ":view")).toBe(false);
      expect(satisfies(["workflows:manage"], "workflows")).toBe(false);
    });
  });

  describe("when the request differs only in case", () => {
    /** @scenario "Permission comparison is case sensitive" */
    it.concurrent("refuses it — permissions are compared exactly", () => {
      expect(satisfies(["workflows:manage"], "Workflows:view")).toBe(false);
      expect(satisfies(["workflows:manage"], "WORKFLOWS:VIEW")).toBe(false);
    });
  });

  describe("when a custom role mixes manage and view grants", () => {
    /** @scenario "A mixed custom bag resolves each resource on its own grant" */
    it.concurrent("resolves each resource on its own grant, not the widest one", () => {
      const custom = ["workflows:manage", "datasets:view", "analytics:manage"];
      expect(satisfies(custom, "workflows:view")).toBe(true);
      expect(satisfies(custom, "datasets:view")).toBe(true);
      expect(satisfies(custom, "datasets:manage")).toBe(false);
      expect(satisfies(custom, "analytics:view")).toBe(true);
    });
  });
});
