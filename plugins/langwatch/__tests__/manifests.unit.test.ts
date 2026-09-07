/**
 * The plugin's manifests, read as the two ecosystems read them.
 *
 * These files are hand-authored JSON that nothing in the build validates, and
 * each of the two clients that consumes them fails in a way nobody sees: an
 * Agent Plugins client REJECTS a plugin whose manifest violates the closed
 * schema, and Claude Code simply loads a plugin whose hooks point at a file
 * that is not there. So the contract is asserted here rather than discovered in
 * somebody's session.
 *
 * The Agent Plugins allowlist below is copied from
 * https://agent-plugins.org/schemas/1.0.0/plugin.schema.json (§5.2 of the
 * specification, "Its schema is closed"). It is transcribed rather than fetched
 * because a unit test must not depend on a network, and because a schema change
 * is a version change: Agent Plugins 1.0.0 is frozen, and moving to a later
 * version is a deliberate edit here.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (...segments: string[]): Record<string, unknown> =>
  JSON.parse(readFileSync(join(pluginRoot, ...segments), "utf8")) as Record<
    string,
    unknown
  >;

/** The only top-level fields Agent Plugins 1.0.0 permits in `plugin.json`. */
const PORTABLE_MANIFEST_KEYS = [
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
] as const;

/** The two the specification makes mandatory. */
const PORTABLE_REQUIRED_KEYS = ["$schema", "name"] as const;

/** The only fields the `author` object may carry. */
const PORTABLE_AUTHOR_KEYS = ["name", "email", "url"] as const;

const PORTABLE_SCHEMA_ID =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** Lowercase alphanumerics, hyphens and periods; alphanumeric at both ends. */
const PORTABLE_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const PLUGIN_NAME = "langwatch";

const portable = readJson("plugin.json");
const claudeCode = readJson(".claude-plugin", "plugin.json");
const marketplace = readJson(".claude-plugin", "marketplace.json");
const packageManifest = readJson("package.json");
const hooks = readJson("hooks", "hooks.json");

describe("the plugin manifests", () => {
  describe("given one directory that both ecosystems install", () => {
    /** @scenario "The three manifests agree on the plugin name and version" */
    it("names and versions the plugin identically in all three", () => {
      expect(portable.name).toBe(PLUGIN_NAME);
      expect(claudeCode.name).toBe(PLUGIN_NAME);

      expect(typeof packageManifest.version).toBe("string");
      expect(portable.version).toBe(packageManifest.version);
      expect(claudeCode.version).toBe(packageManifest.version);
    });
  });

  describe("given the Agent Plugins 1.0 schema is closed", () => {
    /** @scenario "The portable manifest carries only keys the Agent Plugins schema allows" */
    it("carries no key outside the allowlist and declares the schema it targets", () => {
      const unexpected = Object.keys(portable).filter(
        (key) => !(PORTABLE_MANIFEST_KEYS as readonly string[]).includes(key),
      );
      expect(unexpected).toEqual([]);

      for (const key of PORTABLE_REQUIRED_KEYS) {
        expect(portable).toHaveProperty(key);
      }
      expect(portable.$schema).toBe(PORTABLE_SCHEMA_ID);
      expect(portable.name as string).toMatch(PORTABLE_NAME_RE);
      expect((portable.name as string).length).toBeLessThanOrEqual(64);
    });

    describe("when it declares an author", () => {
      it("gives it only the fields the schema permits", () => {
        const author = portable.author as Record<string, unknown>;

        const unexpected = Object.keys(author).filter(
          (key) => !(PORTABLE_AUTHOR_KEYS as readonly string[]).includes(key),
        );
        expect(unexpected).toEqual([]);

        for (const value of Object.values(author)) {
          expect(typeof value).toBe("string");
        }
      });
    });
  });

  describe("given a user adding the marketplace from the repository", () => {
    /** @scenario "The marketplace offers the plugin from the repository root" */
    it("offers exactly the one plugin, sourced from the marketplace's own directory", () => {
      expect(marketplace.name).toBe(PLUGIN_NAME);
      expect((marketplace.owner as Record<string, unknown>).name).toBe(
        "LangWatch",
      );

      const plugins = marketplace.plugins as Array<Record<string, unknown>>;
      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.name).toBe(PLUGIN_NAME);
      expect(plugins[0]?.source).toBe("./");
      expect(typeof plugins[0]?.description).toBe("string");
    });
  });
});

describe("the plugin hook configuration", () => {
  describe("given Claude Code loading the plugin", () => {
    /** @scenario "The hooks run the bundled script at the start and the end of a session" */
    it("declares the two session events, each running the bundled script under a timeout", () => {
      const events = hooks.hooks as Record<
        string,
        Array<{
          hooks: Array<{ type: string; command: string; timeout?: number }>;
        }>
      >;

      expect(Object.keys(events).sort()).toEqual(["SessionStart", "Stop"]);

      for (const groups of Object.values(events)) {
        expect(groups).toHaveLength(1);
        const entries = groups[0]?.hooks ?? [];
        const entry = entries[0]!;
        expect(entry.type).toBe("command");
        // The plugin root is quoted so a path with spaces survives the shell,
        // and the argument names the agent the record is filed under.
        expect(entry.command).toContain(
          '"${CLAUDE_PLUGIN_ROOT}/scripts/session-context.mjs" claude-code',
        );
        expect(entry.command.startsWith("node ")).toBe(true);
        expect(typeof entry.timeout).toBe("number");
        expect(entry.timeout).toBeGreaterThan(0);
        expect(entry.timeout).toBeLessThanOrEqual(60);
      }
    });

    /** @scenario "The plugin's guidance hook emits the guidance as session context" */
    it("runs the guidance script on SessionStart only, beside the context hook", () => {
      const events = hooks.hooks as Record<
        string,
        Array<{
          hooks: Array<{ type: string; command: string; timeout?: number }>;
        }>
      >;

      const commandsOf = (event: string): string[] =>
        (events[event] ?? []).flatMap((group) =>
          group.hooks.map((hook) => hook.command),
        );

      const guidance = commandsOf("SessionStart").filter((command) =>
        command.includes("session-guidance.mjs"),
      );
      expect(guidance).toHaveLength(1);
      expect(guidance[0]).toContain(
        '"${CLAUDE_PLUGIN_ROOT}/scripts/session-guidance.mjs"',
      );
      // Guidance is context for the session's start; the Stop hook stays a
      // single-purpose context reporter.
      expect(
        commandsOf("Stop").some((command) =>
          command.includes("session-guidance.mjs"),
        ),
      ).toBe(false);
    });
  });
});
