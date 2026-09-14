// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Drift guard between the two hand-maintained copies of the governed tool
 * list. The launcher ships its own copy so an offline or legacy CLI still has
 * defaults to fall back on; the server holds the copy the tile config is
 * merged over. Both files carry a comment asking a human to keep them in sync,
 * and until this test nothing enforced it — a tool present in one and absent
 * from the other resolves to the unnamed permissive defaults rather than to
 * something an admin can govern (ADR-132 Gates, "Governance policy entry,
 * both copies").
 *
 * The launcher copy is read from its source file rather than imported: the app
 * and the CLI package are separate builds, and reading by path is how this
 * repository already crosses that boundary (see
 * `src/features/langy/__tests__/capabilityCatalog.coverage.unit.test.ts`).
 * Nothing here restates either list as a literal — a test carrying its own copy
 * of the answer would be a third copy to drift.
 *
 * @see specs/coding-agent/pi-session-capture.feature
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import {
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
  PLATFORM_TOOL_SLUGS,
} from "../platformToolPolicy.service";

const CLI_GOVERNANCE_DIR =
  "../../../../../../sdks/typescript/src/cli/utils/governance/";

const CLI_POLICY_PATH = fileURLToPath(
  new URL(`${CLI_GOVERNANCE_DIR}platform-tool-policy.ts`, import.meta.url),
);
const CLI_OTEL_ENV_PATH = fileURLToPath(
  new URL(`${CLI_GOVERNANCE_DIR}otel-env-block.ts`, import.meta.url),
);

/** Line and block comments removed, so a slug named in prose never parses. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * The body of `export const <name> … = { … };`, from the opening brace to the
 * `};` that closes it at column zero. Both files declare these tables at the
 * top level with no nested multi-line object, which is what makes the
 * column-zero terminator exact.
 */
function objectLiteralBody(source: string, name: string): string {
  // Thrown, not asserted: the parse runs at module scope, so a rename or a
  // stale path has to fail the whole file loudly rather than leave the
  // comparisons below silently comparing empty lists.
  const declaration = source.indexOf(`export const ${name}`);
  if (declaration < 0) {
    throw new Error(
      `\`export const ${name}\` is not declared in the file this test reads. Either it was renamed, or the path is stale.`,
    );
  }
  const open = source.indexOf("{", declaration);
  const close = source.indexOf("\n};", open);
  if (close <= open) {
    throw new Error(
      `\`${name}\` has no column-zero \`};\` terminator — the parser would read past the end of the table.`,
    );
  }
  return source.slice(open, close);
}

/** The keys of a top-level object literal, in declaration order. */
function objectLiteralKeys(source: string, name: string): string[] {
  return [
    ...objectLiteralBody(source, name).matchAll(
      /^[ \t]*([A-Za-z_]\w*)[ \t]*:/gm,
    ),
  ].map((match) => match[1]!);
}

/** The `key: "value"` pairs of a top-level string-valued object literal. */
function objectLiteralStringEntries(
  source: string,
  name: string,
): [string, string][] {
  return [
    ...objectLiteralBody(source, name).matchAll(
      /^[ \t]*([A-Za-z_]\w*)[ \t]*:[ \t]*"([^"]+)"/gm,
    ),
  ].map((match) => [match[1]!, match[2]!]);
}

const cliPolicyTools = objectLiteralKeys(
  withoutComments(readFileSync(CLI_POLICY_PATH, "utf-8")),
  "PLATFORM_TOOL_POLICIES",
);
const cliSourceTypeByTool = objectLiteralStringEntries(
  withoutComments(readFileSync(CLI_OTEL_ENV_PATH, "utf-8")),
  "SOURCE_TYPE_BY_TOOL",
);

describe("the governed tool list, held in two hand-maintained copies", () => {
  describe("when the launcher's copy is parsed out of its source file", () => {
    it("finds the policy table (canary against parser rot)", () => {
      // Without this, a rename or a restructure in the CLI file yields an
      // empty parse, and every comparison below passes by comparing nothing.
      expect(cliPolicyTools.length).toBeGreaterThanOrEqual(7);
      expect(cliPolicyTools).toContain("claude");
      expect(cliPolicyTools).toContain("cursor");
    });

    it("finds the source types the launcher stamps (canary against parser rot)", () => {
      expect(cliSourceTypeByTool.length).toBeGreaterThanOrEqual(6);
      expect(cliSourceTypeByTool).toContainEqual(["claude", "claude_code"]);
    });

    it("names each tool once", () => {
      expect(cliPolicyTools).toEqual([...new Set(cliPolicyTools)]);
    });
  });

  describe("when both copies are read", () => {
    /** @scenario "The two copies of the governed tool list name the same tools" */
    it("names the same tools on both sides", () => {
      const launcher = [...cliPolicyTools].sort();
      const server = [...PLATFORM_TOOL_SLUGS].sort();
      expect(
        launcher,
        [
          "The launcher's PLATFORM_TOOL_POLICIES and the server's PLATFORM_TOOL_SLUGS",
          "no longer name the same tools. A tool in only one copy resolves to the",
          "permissive both-allowed defaults instead of a governable entry.",
          `  only in the launcher: ${launcher.filter((tool) => !server.includes(tool as never)).join(", ") || "(none)"}`,
          `  only on the server:   ${server.filter((tool) => !launcher.includes(tool)).join(", ") || "(none)"}`,
        ].join("\n"),
      ).toEqual(server);
    });

    it("gives every tool a default policy on the server side", () => {
      // PLATFORM_TOOL_SLUGS and PLATFORM_TOOL_POLICY_DEFAULTS agree by the
      // compiler within the file; asserted here so a JS-side edit or a cast
      // cannot leave a slug without the defaults the tile merges over.
      expect(Object.keys(PLATFORM_TOOL_POLICY_DEFAULTS).sort()).toEqual(
        [...PLATFORM_TOOL_SLUGS].sort(),
      );
    });
  });

  describe("when a tool the launcher may send telemetry for is looked up by its source type", () => {
    // Unbound on purpose: no scenario describes this map, and it is the
    // quietest of the three lists. An unmapped source type does not throw at
    // `auth-cli.ts:2582` — `policedSlug` is undefined, the `allowOtelDirect`
    // branch sits inside `if (policedSlug)`, and the mint proceeds. An
    // organisation that switched the tool's direct path off would still be
    // issued a key. Deliberately partial (`cursor` and `copilot_app` have no
    // direct-OTLP wiring), so only the tools the launcher actually stamps a
    // source type for are asserted.
    it("resolves back to the tool that stamped it", () => {
      const unmapped = cliSourceTypeByTool
        .filter(
          ([tool]) =>
            PLATFORM_TOOL_POLICY_DEFAULTS[
              tool as keyof typeof PLATFORM_TOOL_POLICY_DEFAULTS
            ]?.allowOtelDirect,
        )
        .filter(
          ([tool, sourceType]) =>
            PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE[sourceType] !== tool,
        );
      expect(
        unmapped,
        [
          "Source types the launcher stamps for a tool allowed to send telemetry",
          "directly, which PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE does not map back.",
          "The mint route silently skips the allowOtelDirect check for these, so",
          "an organisation that turned the direct path off is still issued a key:",
          ...unmapped.map(
            ([tool, sourceType]) => `  ${sourceType} -> should be ${tool}`,
          ),
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
