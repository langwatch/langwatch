/**
 * The shape of the management command tree, read off the live commander
 * program rather than off a list kept next to it: `buildProgram()` is the
 * ground truth for what the CLI actually registers, so a verb that was never
 * wired up fails here instead of at a customer's terminal.
 *
 * @see specs/typescript-sdk/cli-management-apis.feature
 */
import { describe, expect, it } from "vitest";
import { FEATURE_MAP } from "../../../../internal/generated/cli/feature-map.generated";
import { buildProgram } from "../../../program";
import {
  buildCatalog,
  flattenCatalog,
  type CatalogEntry,
} from "../../../utils/commandCatalog";

// program.ts reads the tsup-injected __CLI_VERSION__ build constant; under
// vitest there is no bundler define, so stub it before buildProgram() runs.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

/** The nine families this work package adds, plus the api-keys additions. */
const MANAGEMENT_GROUPS = [
  "organization",
  "members",
  "invites",
  "teams",
  "groups",
  "roles",
  "role-bindings",
  "scim-tokens",
  "organizations",
] as const;

const catalog = (): CatalogEntry[] => buildCatalog(buildProgram());

const flat = (): CatalogEntry[] => flattenCatalog(catalog());

/** The leaf verbs registered directly under one group, in registration order. */
const verbsOf = (group: string): string[] => {
  const entry = catalog().find((candidate) => candidate.path === group);
  return (entry?.children ?? []).map((child) => child.path.split(" ").pop()!);
};

/** The leaf verbs registered under a nested group, e.g. `teams members`. */
const nestedVerbsOf = (group: string, nested: string): string[] => {
  const entry = catalog().find((candidate) => candidate.path === group);
  const child = entry?.children.find(
    (candidate) => candidate.path === `${group} ${nested}`,
  );
  return (child?.children ?? []).map((leaf) => leaf.path.split(" ").pop()!);
};

/** Every flag spelling one command carries, e.g. `--role <role>`. */
const flagsOf = (path: string): string[] => {
  const entry = flat().find((candidate) => candidate.path === path);
  return (entry?.flags ?? []).map((flag) => flag.name);
};

const carriesFlag = (path: string, flag: string): boolean =>
  flagsOf(path).some((name) => name.includes(flag));

describe("the management command tree", () => {
  describe("when the command catalog is built", () => {
    /** @scenario The organization commands cover get and update */
    it("gives the organization family get and update, and update accepts the name", () => {
      expect(verbsOf("organization")).toEqual(["get", "update"]);
      expect(carriesFlag("organization update", "--name <name>")).toBe(true);
    });

    /** @scenario The members commands cover the membership lifecycle */
    it("gives the members family the whole lifecycle, and update accepts the organization role", () => {
      expect(verbsOf("members")).toEqual([
        "list",
        "get",
        "update",
        "disable",
        "enable",
        "remove",
        "access",
      ]);
      expect(carriesFlag("members update", "--role <role>")).toBe(true);
    });

    /** @scenario Team commands cover the team lifecycle and membership */
    it("gives the teams family its lifecycle plus nested member commands, and add accepts the role", () => {
      expect(verbsOf("teams")).toEqual([
        "list",
        "get",
        "create",
        "update",
        "archive",
        "members",
      ]);
      expect(nestedVerbsOf("teams", "members")).toEqual([
        "list",
        "add",
        "remove",
      ]);
      expect(carriesFlag("teams members add", "--role <role>")).toBe(true);
    });

    /** @scenario Group commands cover groups, membership and bindings */
    it("gives the groups family its lifecycle plus nested member and binding commands", () => {
      expect(verbsOf("groups")).toEqual([
        "list",
        "get",
        "create",
        "rename",
        "delete",
        "members",
        "bindings",
      ]);
      expect(nestedVerbsOf("groups", "members")).toEqual([
        "list",
        "add",
        "remove",
      ]);
      expect(nestedVerbsOf("groups", "bindings")).toEqual([
        "list",
        "add",
        "remove",
      ]);

      // A binding is a role at a scope, and may defer to a custom role.
      const addBinding = flagsOf("groups bindings add").join(" ");
      expect(addBinding).toContain("--role <role>");
      expect(addBinding).toContain("--custom-role-id <id>");
      expect(addBinding).toContain("--scope-type <type>");
      expect(addBinding).toContain("--scope-id <id>");
    });

    /** @scenario Every management command is covered by the feature map */
    it("declares every management command in the feature map", () => {
      const declared = new Set(
        (function collect(features: typeof FEATURE_MAP.features): string[] {
          return features.flatMap((feature) => [
            ...(feature.surfaces?.code?.cli ?? []),
            ...collect(feature.children ?? []),
          ]);
        })(FEATURE_MAP.features),
      );

      const managementLeaves = flat()
        .filter(
          (entry) =>
            entry.children.length === 0 &&
            (MANAGEMENT_GROUPS as readonly string[]).includes(
              entry.path.split(" ")[0]!,
            ),
        )
        .map((entry) => entry.path);

      // Canary: an empty list would make the check below pass vacuously.
      expect(managementLeaves.length).toBeGreaterThanOrEqual(40);

      const undeclared = managementLeaves.filter(
        (path) => !declared.has(path),
      );
      expect(
        undeclared,
        [
          "Management commands with no feature-map entry.",
          "Add them to the owning feature's surfaces.code.cli in feature-map.json:",
          ...undeclared.map((path) => `  langwatch ${path}`),
        ].join("\n"),
      ).toEqual([]);

      // The api-keys additions ride on the existing feature rather than a new
      // one, so they are checked by name.
      expect(declared.has("api-keys get")).toBe(true);
      expect(declared.has("api-keys update")).toBe(true);
    });
  });
});
