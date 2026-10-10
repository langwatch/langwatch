import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { RuleTester } from "oxlint/plugins-dev";

import { resetClassificationCache } from "./classify.mjs";
import { renderMessage } from "./define-rule.mjs";

// Running a rule and standing up a workspace for it to run in. Rule tests used
// to point the tester at the real repository root, so `catalogue.json` and
// every feature `package.json` were live inputs and renaming a feature broke
// the lint suite. A fixture tree is the input now.

/**
 * @typedef {{ messageId: string | undefined, message: string,
 *   data: Record<string, unknown>, line: number | undefined }} Diagnostic
 * `message` is the rendered `what` + `fix`, with `{{}}` already filled in.
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
 * Runs one rule over one source string; intercepts `context.report` so the
 * tester sees a clean file while we keep the diagnostics.
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
    // An empty `options` is not the same as no options: the tester rejects
    // the key outright on a rule that declares no schema.
    const testCase = options.length > 0 ? { code, filename, options } : { code, filename };
    tester.run(rule.meta?.docs?.name ?? "rule-under-test", probe, {
      valid: [testCase],
      invalid: [],
    });
  });
  resetClassificationCache();

  return reports;
}

/**
 * Asserts what `pnpm lint:fix` would leave behind, via the linter's own fixer.
 * @param {{ meta: object, create: Function }} rule
 * @param {object} run `{ code, filename, output, cwd?, errors?, options? }`
 */
export function expectFix(
  rule,
  { code, cwd = process.cwd(), errors = 1, filename, options = [], output },
) {
  resetClassificationCache();
  withSilentTestHooks(() => {
    const tester = new RuleTester({ cwd, languageOptions: { sourceType: "module" } });
    const testCase = { code, errors, filename, output };
    if (options.length > 0) testCase.options = options;
    tester.run(rule.meta?.docs?.name ?? "rule-under-test", rule, {
      valid: [],
      invalid: [testCase],
    });
  });
  resetClassificationCache();
}

function writeFile(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);

  return path;
}

/**
 * A throwaway workspace for a rule to be linted inside.
 * @param {object} [tree.features] Feature name to the contract/server/web
 *   packages that exist for it. A module's presence and its package.json
 *   exports are the whole declaration; there is no feature.json side-channel.
 * @param {object} [tree.catalogue] Feature id to the subjects it claims.
 * @param {Record<string, string>} [tree.files] Extra files, keyed by path.
 * @returns {object} cwd, write(path, contents), and cleanup().
 */
export function createFixtureWorkspace({ catalogue = {}, features = {}, files = {} } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "langwatch-lint-")));
  writeFile(cwd, "package.json", JSON.stringify({ name: "fixture-workspace", private: true }));

  for (const [feature, definition] of Object.entries(features)) {
    const root = `modules/${feature}`;
    for (const [role, pkg] of Object.entries(definition.roles ?? {})) {
      const exports = Object.fromEntries((pkg.exports ?? ["."]).map((entry) => [entry, entry]));
      writeFile(
        cwd,
        `${root}/${role}/package.json`,
        JSON.stringify({ exports, name: `@langwatch/${feature}-${role}`, private: true }),
      );
    }
  }

  const catalogueFeatures = Object.entries(catalogue).map(([id, subjects]) => ({ id, subjects }));
  writeFile(
    cwd,
    "modules/catalogue.json",
    JSON.stringify({ version: 0, features: catalogueFeatures }),
  );
  for (const [path, contents] of Object.entries(files)) writeFile(cwd, path, contents);

  return {
    cwd,
    write: (path, contents) => writeFile(cwd, path, contents),
    cleanup: () => rmSync(cwd, { force: true, recursive: true }),
  };
}
