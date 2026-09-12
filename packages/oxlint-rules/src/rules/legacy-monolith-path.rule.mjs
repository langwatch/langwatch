import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// `platform/app` was the monolith that `apps/*` and `modules/*` replaced, and
// `~/` was the alias that only resolved inside it. No tsconfig maps `~/*` now,
// so a stale path resolves to nothing and TypeScript says so only when something
// reaches the file - which is how a moved test or a half-finished port keeps
// compiling until the first import of it.

// `platform/app` is the monolith itself, anchored so the legitimate nested
// `apps/api/src/platform/config/` is left alone, and `cross-platform/` with it.
const LEGACY_PATH = /^~\//;
const MONOLITH_PATH = /(?:^|[./])platform\/app(?:\/|$)/;

export const legacyMonolithPathRule = defineRule({
  name: "legacy-monolith-path",
  kind: "problem",
  messages: {
    legacyMonolithPath: {
      what: "`{{name}}` names the deleted monolith.",
      why: "Nothing maps `~/*` and `platform/` is gone, so the path resolves to nothing until something reaches the file.",
      fix: "Point it at the package that owns the code now - `modules/<feature>/{contract,server,web}`, `packages/<name>` or `apps/<app>`.",
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "legacy-monolith-path" })) {
      return {};
    }

    // One visitor: an import source IS a string literal, so this catches the
    // specifier and the loose path in a script or a config object in one pass.
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!LEGACY_PATH.test(node.value) && !MONOLITH_PATH.test(node.value)) return;

        context.report({ data: { name: node.value }, messageId: "legacyMonolithPath", node });
      },
    };
  },
});
