import { describe, expect, it } from "vitest";
import { bindIdentifiers } from "./identifiers";

/** Reads the parameter key back out of a `{key:Identifier}` placeholder. */
function keyOf(placeholder: string): string {
  const key = /^\{(.+):Identifier\}$/.exec(placeholder)?.[1];
  if (!key) throw new Error(`not an identifier placeholder: ${placeholder}`);
  return key;
}

function nameBehind(
  names: ReturnType<typeof bindIdentifiers>,
  placeholder: string,
): unknown {
  return names.params[keyOf(placeholder)];
}

describe("given bindIdentifiers()", () => {
  describe("when several distinct names are bound", () => {
    it("gives each name a placeholder of its own", () => {
      const names = bindIdentifiers();

      const table = names.of("fold_state");
      const tenant = names.of("TenantId");
      const key = names.of("AggregateId");

      expect(new Set([table, tenant, key]).size).toBe(3);
    });

    it("resolves every placeholder back to the name it stands for", () => {
      const names = bindIdentifiers();
      const bound = ["fold_state", "TenantId", "AggregateId"].map(
        (name) => [name, names.of(name)] as const,
      );

      for (const [name, placeholder] of bound) {
        expect(nameBehind(names, placeholder)).toBe(name);
      }
    });
  });

  describe("when the same name is bound twice", () => {
    it("reuses the one placeholder instead of adding a second parameter", () => {
      const names = bindIdentifiers();

      const first = names.of("TenantId");
      names.of("AggregateId");
      const second = names.of("TenantId");

      expect(second).toBe(first);
      expect(Object.keys(names.params)).toHaveLength(2);
    });
  });

  describe("when a select list is bound", () => {
    it("emits one placeholder per name, in the order given", () => {
      const names = bindIdentifiers();

      const list = names.list(["TenantId", "AggregateId", "WrittenAt"]);

      expect(list.split(", ").map((each) => nameBehind(names, each))).toEqual([
        "TenantId",
        "AggregateId",
        "WrittenAt",
      ]);
    });

    it("repeats the placeholder of a name it already bound", () => {
      const names = bindIdentifiers();
      const tenant = names.of("TenantId");

      const list = names.list(["TenantId", "AggregateId"]);

      expect(list.split(", ")[0]).toBe(tenant);
      expect(Object.keys(names.params)).toHaveLength(2);
    });
  });

  describe("when two binders are used for two queries", () => {
    it("keeps each one's parameters to itself", () => {
      const first = bindIdentifiers();
      const second = bindIdentifiers();

      first.of("fold_state");
      second.of("append_log");

      expect(Object.values(first.params)).toEqual(["fold_state"]);
      expect(Object.values(second.params)).toEqual(["append_log"]);
    });
  });
});
