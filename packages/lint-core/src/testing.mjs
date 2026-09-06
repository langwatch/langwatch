import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { resetClassificationCache } from "./classify.mjs";
import { renderMessage } from "./define-rule.mjs";

// Running a rule and standing up a workspace for it to run in. Rule tests used
// to point the tester at the real repository root, so `feature.json`,
// `catalogue.json` and every feature `package.json` were live inputs and
// renaming a feature broke the lint suite. A fixture tree is the input now.

/**
 * @typedef {object} Diagnostic
 * @property {string | undefined} messageId
 * @property {string} message The rendered `what` + `fix`, with `{{}}` filled in.
 * @property {Record<string, unknown>} data
 * @property {number | undefined} line
 */

function withSilentTestHooks(run) {
  const { describe, it } = RuleTester;
  RuleTester.describe = (_name, body) => body();
  RuleTester.it = (_name, body) => body();
  try {
    return run();
  } finally {
    RuleTester.describe = describe;
    RuleTester.it = it;
  }
}

/**
 * Runs one rule over one source string and returns what it reported.
 *
 * The rule's `context.report` is intercepted rather than forwarded, so the
 * tester sees a clean file and we keep the diagnostics.
 *
 * @param {{ meta: object, create: Function }} rule
 * @param {{ code: string, filename: string, options?: unknown[], cwd?: string }} run
 * @returns {Diagnostic[]}
 */
export function runRule(rule, { code, cwd = process.cwd(), filename, options = [] }) {
  const reports = [];
  const templates = rule.meta?.messages ?? {};
  // A node's `loc` is computed from a source buffer the linter frees when the
  // run ends, so each report is flattened here and not after.
  const record = (descriptor) => {
    const data = descriptor.data ?? {};
    reports.push({
      data,
      line: descriptor.loc?.line ?? descriptor.node?.loc?.start?.line,
      message: descriptor.message ?? renderMessage(templates[descriptor.messageId] ?? "", data),
      messageId: descriptor.messageId,
    });
  };
  const probe = {
    meta: rule.meta,
    create(context) {
      // The linter's own `context.report` is a read-only, non-configurable
      // property, so the interception is a child object rather than a proxy.
      const intercepted = Object.create(context, { report: { value: record } });

      return rule.create(intercepted);
    },
  };

  resetClassificationCache();
  withSilentTestHooks(() => {
    const tester = new RuleTester({ cwd, languageOptions: { sourceType: "module" } });
    tester.run(rule.meta?.docs?.name ?? "rule-under-test", probe, {
      valid: [{ code, filename, options }],
      invalid: [],
    });
  });
  resetClassificationCache();

  return reports;
}

function writeFile(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);

  return path;
}

/**
 * A throwaway workspace for a rule to be linted inside.
 *
 * @param {object} [tree]
 * @param {Record<string, { layoutVersion?: number, roles?: Record<string, { exports?: string[] }> }>} [tree.features]
 *   Feature name to its `feature.json` layout version and the contract/server/web
 *   packages that exist for it.
 * @param {Record<string, string[]>} [tree.catalogue] Subject to the features that claim it.
 * @param {Record<string, string>} [tree.files] Extra files, keyed by workspace path.
 * @returns {{ cwd: string, write: (path: string, contents: string) => string, cleanup: () => void }}
 */
export function createFixtureWorkspace({ catalogue = {}, features = {}, files = {} } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "langwatch-lint-")));
  writeFile(cwd, "package.json", JSON.stringify({ name: "fixture-workspace", private: true }));

  for (const [feature, definition] of Object.entries(features)) {
    const root = `packages/features/${feature}`;
    writeFile(
      cwd,
      `${root}/feature.json`,
      JSON.stringify({ layoutVersion: definition.layoutVersion ?? 0, name: feature }),
    );
    for (const [role, pkg] of Object.entries(definition.roles ?? {})) {
      const exports = Object.fromEntries((pkg.exports ?? ["."]).map((entry) => [entry, entry]));
      writeFile(
        cwd,
        `${root}/${role}/package.json`,
        JSON.stringify({ exports, name: `@langwatch/${feature}-${role}`, private: true }),
      );
    }
  }

  writeFile(cwd, "packages/features/catalogue.json", JSON.stringify({ subjects: catalogue }));
  for (const [path, contents] of Object.entries(files)) writeFile(cwd, path, contents);

  return {
    cwd,
    write: (path, contents) => writeFile(cwd, path, contents),
    cleanup: () => rmSync(cwd, { force: true, recursive: true }),
  };
}
