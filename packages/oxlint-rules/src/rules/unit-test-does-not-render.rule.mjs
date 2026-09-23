import { defineRule } from "../define-rule.mjs";

// A test that renders a component is an integration test (TESTING_PHILOSOPHY.md);
// importing `@testing-library/*` means it renders, so a `.unit.test` or unlevelled
// `.test.tsx` doing so is misnamed. `.browser.test.tsx` is vitest's real-browser
// lane (`BROWSER_TEST_GLOB`). Known miss: `render` re-exported via test-utils.

const UNIT_TEST_FILE = /\.unit\.test\.tsx?$/;
const COMPONENT_TEST_FILE = /\.test\.tsx$/;
const RENDERING_LEVEL = /\.(?:integration|e2e|browser)\.test\.tsx$/;
const TESTING_LIBRARY_SPECIFIER = /^@testing-library\//;
const TEST_SUFFIX = /(?:\.unit)?\.test\.(tsx?)$/;

function isGovernedTestFile(file) {
  const path = file.workspacePath;
  if (UNIT_TEST_FILE.test(path)) return true;

  return COMPONENT_TEST_FILE.test(path) && !RENDERING_LEVEL.test(path);
}

/** `thing.unit.test.tsx` or `thing.test.tsx` renamed to `thing.integration.test.tsx`. */
function integrationTestNameFor(workspacePath) {
  const basename = workspacePath.slice(workspacePath.lastIndexOf("/") + 1);
  return basename.replace(TEST_SUFFIX, ".integration.test.$1");
}

export const unitTestDoesNotRenderRule = defineRule({
  name: "unit-test-does-not-render",
  kind: "problem",
  applies: isGovernedTestFile,
  messages: {
    unitTestImportsRenderer: {
      what: "`{{specifier}}` renders components, and `{{name}}` is not named as an integration test.",
      why: "A test that renders a component and mocks its boundaries is an integration test.",
      fix: "Rename the file to `{{target}}` and leave the content unchanged.",
    },
  },
  create(context, file) {
    // Once per file: the name, not the number of imports, is the defect.
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
          data: {
            name: file.workspacePath.slice(file.workspacePath.lastIndexOf("/") + 1),
            specifier,
            target: integrationTestNameFor(file.workspacePath),
          },
        });
      },
    };
  },
});
