import {
  CANONICAL_ARTIFACTS,
  isLowerKebabFilename,
  isStrictServerFilename,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

const ALLOWED_ARTIFACTS = [...CANONICAL_ARTIFACTS].sort().join(", ");

export const featureSourceFilenameRule = defineRule({
  name: "feature-source-filename",
  kind: "problem",
  messages: {
    filename: {
      what: "`{{name}}` is not `<subject>.<artifact>.ts` in lower kebab case.",
      fix: "Rename it after the subject and the artifact, e.g. `trace-search.service.ts`; the artifacts are {{artifacts}}.",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source) return {};
    if (!/\.[cm]?[jt]sx?$/.test(source.name)) return {};
    const valid =
      source.role === "server"
        ? isStrictServerFilename(source.name)
        : isLowerKebabFilename(source.name);
    if (valid) return {};

    return {
      Program(node) {
        context.report({
          node,
          messageId: "filename",
          data: { name: source.name, artifacts: ALLOWED_ARTIFACTS },
        });
      },
    };
  },
});
