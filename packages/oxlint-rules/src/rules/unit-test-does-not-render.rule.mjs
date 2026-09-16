import { defineRule } from "../define-rule.mjs";

// A test that renders a component and mocks its boundaries is an
// INTEGRATION test, not a unit test (TESTING_PHILOSOPHY.md). Import-based
// detection: every renderer crosses this package boundary, so a `.unit.test`
// file naming `@testing-library/*` is misnamed, not miswritten — the fix is
// a rename, not a rewrite. Known miss: `render` re-exported via test-utils.

const UNIT_TEST_FILE = /\.unit\.test\.tsx?$/;
const TESTING_LIBRARY_SPECIFIER = /^@testing-library\//;
const INTEGRATION_TEST_SUFFIX = /\.unit\.test\.(tsx?)$/;

function isUnitTestFile(file) {
  return UNIT_TEST_FILE.test(file.workspacePath);
}

/** `thing.unit.test.tsx` renamed to the integration-test form it should carry. */
function integrationTestNameFor(workspacePath) {
  const basename = workspacePath.slice(workspacePath.lastIndexOf("/") + 1);
  return basename.replace(INTEGRATION_TEST_SUFFIX, ".integration.test.$1");
}

export const unitTestDoesNotRenderRule = defineRule({
  name: "unit-test-does-not-render",
  kind: "problem",
  applies: isUnitTestFile,
  messages: {
    unitTestImportsRenderer: {
      what: "`{{specifier}}` is imported by a `.unit.test` file, and it renders components.",
      why: "A test that renders a component and mocks its boundaries is an integration test.",
      fix: "Rename the file to `{{target}}` and leave the content unchanged.",
    },
  },
  create(context, file) {
    // Reported once per file: the file's name, not the number of imports, is
    // the defect.
    let reported = false;

    return {
      ImportDeclaration(node) {
        if (reported) return;
        if (node.importKind === "type") return;

        const specifier = node.source?.value;
        if (typeof specifier !== "string" || !TESTING_LIBRARY_SPECIFIER.test(specifier)) return;

        reported = true;
        context.report({
          node,
          messageId: "unitTestImportsRenderer",
          data: { specifier, target: integrationTestNameFor(file.workspacePath) },
        });
      },
    };
  },
});
