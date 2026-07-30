import { describe, expect, it } from "vitest";
import {
  COLLAPSE_KINDS,
  PROJECTION_KINDS,
  SCOPE_KINDS,
  STORE_KINDS,
} from "./mount.types";
import type { Mount, MountShape } from "./mount.types";
import { LEGAL_MOUNT_SHAPES, validateMount } from "./validateMount";

/**
 * ADR-106 unifies three rules that used to be enforced in three different
 * places, so these tests are about the same thing from two angles: every
 * combination decision 2's table forbids is refused with a reason a reader
 * can act on, and every combination it allows passes untouched. The
 * exhaustiveness block at the bottom is what stops a fourth place for the
 * next rule to fail to be added.
 *
 * What is deliberately not here: a test that builds a throwaway `throw new
 * ConfigurationError(...)` wrapper inline and asserts on it. That would
 * exercise code the test itself just wrote, not anything `validateMount`
 * exports — "the caller throws with all of them" is a calling convention for
 * whoever composes a pipeline, not a claim this module's tests can back with
 * a real call.
 */

function toMount(shape: MountShape): Mount {
  const { projection, scope, collapse, store } = shape;
  if (store === "merge") {
    return { projection, scope, collapse, store, idempotency: "upstream-exactly-once" };
  }
  return { projection, scope, collapse, store, idempotency: undefined };
}

const legalFold: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "none",
  idempotency: undefined,
};

const legalMap: Mount = {
  projection: "map",
  store: "append",
  scope: "partition",
  collapse: "batch",
  idempotency: undefined,
};

/**
 * `Mount`'s discriminated union makes "`store: 'merge'` with no `idempotency`"
 * impossible to write as a literal — that is the point of the type (see
 * `mount.types.ts`). But a `Mount` this checker receives is not always a
 * literal: it can be assembled from a config value the type system never
 * narrowed. `merge-requires-idempotency` exists for exactly that gap, so
 * exercising it means deliberately building the value the type forbids,
 * the way a decoded config would.
 */
function mergeWithoutIdempotency(fields: {
  readonly projection: Mount["projection"];
  readonly scope: Mount["scope"];
  readonly collapse: Mount["collapse"];
}): Mount {
  return {
    ...fields,
    store: "merge",
    idempotency: undefined,
  } as unknown as Mount;
}

describe("validateMount", () => {
  describe("given a fold mounted on a lane wider than one aggregate", () => {
    /** @scenario a projection that reads its prior state is mounted on a lane shared by many aggregates */
    it("refuses the mount and names the concurrency race that would lose an update", () => {
      const violations = validateMount({
        ...legalFold,
        scope: "partition",
      });

      expect(violations.map((v) => v.rule)).toContain(
        "fold-scope-must-be-aggregate",
      );
      const violation = violations.find(
        (v) => v.rule === "fold-scope-must-be-aggregate",
      )!;
      expect(violation.message).toMatch(/race/i);
      expect(violation.message).not.toMatch(/invalid combination/i);
    });

    it("refuses every non-aggregate scope, not only one", () => {
      for (const scope of SCOPE_KINDS.filter((s) => s !== "aggregate")) {
        const violations = validateMount({ ...legalFold, scope });
        expect(violations.map((v) => v.rule)).toContain(
          "fold-scope-must-be-aggregate",
        );
      }
    });
  });

  describe("given a fold told to discard everything but the latest event", () => {
    /** @scenario a projection that accumulates state is told to discard everything but the latest event */
    it("refuses the mount and names the contribution that never arrives", () => {
      const violations = validateMount({ ...legalFold, collapse: "latest" });

      const violation = violations.find(
        (v) => v.rule === "fold-collapse-must-not-be-latest",
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/never arrives|undercount/i);
    });

    it("does not refuse a fold gathering a batch for its own aggregate", () => {
      const violations = validateMount({ ...legalFold, collapse: "batch" });
      expect(violations.map((v) => v.rule)).not.toContain(
        "fold-collapse-must-not-be-latest",
      );
    });
  });

  describe("given a lane holding exactly one event is asked to gather a batch", () => {
    /** @scenario a lane holding exactly one event is asked to gather a batch */
    it("refuses the mount and names why the lane can never batch", () => {
      const violations = validateMount({
        ...legalMap,
        scope: "event",
        collapse: "batch",
      });

      const violation = violations.find(
        (v) => v.rule === "event-scope-cannot-batch",
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/no-op|never hold more than one/i);
    });

    it("allows an event-scoped lane that does not try to batch", () => {
      const violations = validateMount({
        ...legalMap,
        scope: "event",
        collapse: "none",
      });
      expect(violations.map((v) => v.rule)).not.toContain(
        "event-scope-cannot-batch",
      );
    });
  });

  describe("given a fold mounted on a store that never reads back", () => {
    /** @scenario a projection that reads its prior state is mounted on a store that never reads back */
    it("refuses the mount and names that the fold has nowhere to read from", () => {
      const violations = validateMount({ ...legalFold, store: "append" });

      const violation = violations.find(
        (v) => v.rule === "fold-store-must-be-replace",
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/nowhere to read/i);
    });
  });

  describe("given a mount choosing a store that combines rows by their key", () => {
    /** @scenario a projection is mounted on a store that combines rows by their key */
    it("refuses the mount and names that the kind is closed to new adopters", () => {
      const violations = validateMount({
        ...legalMap,
        store: "merge",
        idempotency: "whole-bucket-replace",
      });

      const violation = violations.find(
        (v) => v.rule === "merge-closed-to-new-adopters",
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/closed to new/i);
    });

    /** @scenario a merge-backed mount does not say how a redelivered write avoids double counting */
    it("also refuses a merge mount that does not declare its idempotency story", () => {
      const violations = validateMount(mergeWithoutIdempotency(legalMap));

      const violation = violations.find(
        (v) => v.rule === "merge-requires-idempotency",
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/double count/i);
    });

    it("does not repeat the idempotency violation once it is declared", () => {
      const violations = validateMount({
        ...legalMap,
        store: "merge",
        idempotency: "upstream-exactly-once",
      });
      expect(violations.map((v) => v.rule)).not.toContain(
        "merge-requires-idempotency",
      );
      // Still refused — declaring idempotency does not reopen `merge`.
      expect(violations.map((v) => v.rule)).toContain(
        "merge-closed-to-new-adopters",
      );
    });
  });

  describe("given a mount that breaks more than one rule at once", () => {
    /** @scenario a mount is wrong in more than one way at once */
    it("reports every broken rule, not only the first one found", () => {
      const violations = validateMount(
        mergeWithoutIdempotency({
          projection: "fold",
          scope: "global",
          collapse: "latest",
        }),
      );

      // fold+global (not aggregate), fold+latest, fold+merge (not replace),
      // merge itself, and merge without idempotency — five independent rules.
      expect(violations.map((v) => v.rule).sort()).toEqual(
        [
          "fold-collapse-must-not-be-latest",
          "fold-scope-must-be-aggregate",
          "fold-store-must-be-replace",
          "merge-closed-to-new-adopters",
          "merge-requires-idempotency",
        ].sort(),
      );
    });
  });

  describe("given a mount that satisfies every rule", () => {
    /** @scenario a projection that reads its prior state is mounted correctly */
    it("returns no violations for a fold scoped to one aggregate on a store that reads back", () => {
      expect(validateMount(legalFold)).toEqual([]);
    });

    /** @scenario a projection that writes independent records groups its work by a declared partition */
    it("returns no violations for a map batching a declared partition", () => {
      expect(validateMount(legalMap)).toEqual([]);
    });
  });

  describe("given the legal-shape enumeration", () => {
    const allShapes: MountShape[] = PROJECTION_KINDS.flatMap((projection) =>
      STORE_KINDS.flatMap((store) =>
        SCOPE_KINDS.flatMap((scope) =>
          COLLAPSE_KINDS.map((collapse) => ({ projection, store, scope, collapse })),
        ),
      ),
    );

    const sameShape = (a: MountShape, b: MountShape): boolean =>
      a.projection === b.projection &&
      a.store === b.store &&
      a.scope === b.scope &&
      a.collapse === b.collapse;

    it("lists at least one legal shape", () => {
      // Guards the guard, the way `purity.unit.test.ts` guards its own file
      // walk: without this, a broken enumeration would make every assertion
      // below vacuously true.
      expect(LEGAL_MOUNT_SHAPES.length).toBeGreaterThan(0);
    });

    it("names no shape more than once", () => {
      const duplicates = LEGAL_MOUNT_SHAPES.filter(
        (shape, index) =>
          LEGAL_MOUNT_SHAPES.findIndex((other) => sameShape(other, shape)) !==
          index,
      );
      expect(duplicates).toEqual([]);
    });

    /** @scenario every combination a mount could declare is either accepted or refused */
    it("classifies every combination the mount's fields can express, agreeing with the checker", () => {
      for (const shape of allShapes) {
        const declaredLegal = LEGAL_MOUNT_SHAPES.some((legal) =>
          sameShape(legal, shape),
        );
        const checkerLegal = validateMount(toMount(shape)).length === 0;
        expect(checkerLegal).toBe(declaredLegal);
      }
    });
  });
});
