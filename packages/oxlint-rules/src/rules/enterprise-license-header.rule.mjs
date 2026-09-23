import { defineRule } from "../define-rule.mjs";

// An Enterprise SPDX directive outside `enterprise/` marks proprietary source
// that sits in the open tree; the directive is the placement signal.

const LICENSED_ROOTS = new Set(["apps", "modules", "packages"]);
const IGNORED_SEGMENTS = new Set([
  "__fixtures__",
  "__tests__",
  "dist",
  "fixtures",
  "generated",
  "node_modules",
  "tests",
]);
const IMPLEMENTATION = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/;
const MARKER = "LicenseRef-LangWatch-Enterprise";
const DIRECTIVE = /^SPDX-License-Identifier:\s*LicenseRef-LangWatch-Enterprise\s*$/;
const COMMENT_OPENER = /^(?:\/\/|\/\*+|\*)\s*/;
const COMMENT_CLOSER = /\s*\*\/$/;

function isOpenTreeImplementation(file) {
  const path = file.workspacePath;
  if (!IMPLEMENTATION.test(path) || DECLARATION.test(path)) return false;
  if (TEST_FILE.test(path)) return false;
  const segments = path.split("/");
  if (!LICENSED_ROOTS.has(segments[0])) return false;

  return !segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

function isDirectiveLine(line) {
  const text = line.trim().replace(COMMENT_OPENER, "").replace(COMMENT_CLOSER, "");

  return DIRECTIVE.test(text);
}

/** The line of the first SPDX Enterprise directive in any comment, or 0 when there is none. */
function directiveLine(source, comments) {
  for (const comment of comments) {
    const lines = source.slice(comment.start, comment.end).split(/\r?\n/);
    const index = lines.findIndex(isDirectiveLine);
    if (index >= 0) return comment.loc.start.line + index;
  }

  return 0;
}

export const enterpriseLicenseHeaderRule = defineRule({
  name: "enterprise-license-header",
  kind: "problem",
  applies: isOpenTreeImplementation,
  messages: {
    enterpriseLicenseOutsideEnterprise: {
      what: "This file carries the Enterprise SPDX directive but lives outside `enterprise/`.",
      why: "Enterprise-licensed source belongs to an Enterprise module; the directive is how misplaced proprietary code is found.",
      fix: "Move the implementation into its Enterprise module under `enterprise/modules/<name>/` and expose only its contract to the open tree; never delete the directive to pass.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const source = context.sourceCode.text;
        if (!source.includes(MARKER)) return;
        const comments = (program.comments ?? []).toSorted(
          (left, right) => left.start - right.start,
        );
        const line = directiveLine(source, comments);
        if (line === 0) return;

        context.report({
          loc: { line, column: 0 },
          messageId: "enterpriseLicenseOutsideEnterprise",
        });
      },
    };
  },
});
