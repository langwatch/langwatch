import { defineRule } from "../define-rule.mjs";

// The tenant guards in @langwatch/clickhouse-client and @langwatch/prisma-client let a statement
// skip the tenant predicate only through `SKIP_TENANT_CHECK: true` (Alex, 2026-10-10). The flag
// is counted at runtime; this rule makes every one carry its reason in the comment above it.

const MIN_REASON_LENGTH = 20;
const PLACEHOLDER =
  /^(?:todo|tbd|fixme|xxx|hack|n\/?a|none|skip(?:ped)?|temp(?:orary)?|tests?|testing|reason|wip|ok)\b/i;
const RETIRED_COMMENT = /--\s*@tenancy\s*:/;
const LINE_ENDS_HERE = /^[ \t]*\r?\n$/;

const keyName = (property) =>
  property.computed ? undefined : (property.key?.name ?? property.key?.value);

const isTrue = (node) => node?.type === "Literal" && node.value === true;

/** The comment text ending on the line just above `offset`'s line, joined across a `//` run. */
function reasonAbove({ comments, text, offset }) {
  let lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const parts = [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment.end > lineStart) continue;
    if (!LINE_ENDS_HERE.test(text.slice(comment.end, lineStart))) break;
    parts.unshift(comment.value);
    if (comment.type !== "Line") break;
    lineStart = text.lastIndexOf("\n", comment.start - 1) + 1;
    if (text.slice(lineStart, comment.start).trim() !== "") break;
  }

  return parts
    .join(" ")
    .replace(/^\s*\*+|\n\s*\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reasonIsReal(reason) {
  return reason.length >= MIN_REASON_LENGTH && !PLACEHOLDER.test(reason);
}

/** `unscoped: { reason }` beside a statement, or naming one: the retired ClickHouse opt-out. */
function isRetiredUnscoped(property) {
  if (keyName(property) !== "unscoped") return false;
  const value = property.value;
  if (value?.type === "ObjectExpression") {
    return value.properties.some((inner) => keyName(inner) === "reason");
  }

  return (property.parent?.properties ?? []).some((sibling) =>
    ["sql", "query", "tenantId"].includes(keyName(sibling)),
  );
}

export const skipTenantCheckReasonRule = defineRule({
  name: "skip-tenant-check-reason",
  kind: "problem",
  messages: {
    missingReason: {
      what: "`SKIP_TENANT_CHECK: true` has no real reason in the comment directly above it.",
      why: "A skipped tenant check can read every tenant's rows; the reason is what a reviewer audits.",
      fix: "Write a comment on the line directly above the flag saying why this statement spans tenants (at least 20 characters, not a placeholder such as TODO, n/a, skip, temp or tests), or scope the statement to its tenant instead.",
    },
    retiredUnscoped: {
      what: "`unscoped` is the retired ClickHouse opt-out from the tenant check.",
      why: "The client reads only `SKIP_TENANT_CHECK`, so a statement carrying `unscoped` is refused at runtime.",
      fix: "Replace it with `SKIP_TENANT_CHECK: true` and move the reason into a comment directly above the flag.",
    },
    retiredTenancyComment: {
      what: "The `@tenancy` SQL comment is the retired Postgres opt-out from the tenant check.",
      why: "The raw-SQL guard no longer reads SQL comments, so the statement is refused at runtime.",
      fix: "Interpolate `skipTenantCheck({ SKIP_TENANT_CHECK: true })` from `@langwatch/prisma-client` (`.sql` in an `Unsafe` string) with the reason in a comment directly above the flag, or compare a tenant column with a bound parameter.",
    },
  },
  create(context) {
    let comments;
    const commentsOf = (program) =>
      (comments ??= (program.comments ?? []).toSorted((left, right) => left.start - right.start));
    let program;

    return {
      Program(node) {
        program = node;
      },
      Property(node) {
        if (isRetiredUnscoped(node)) {
          context.report({ node, messageId: "retiredUnscoped" });
          return;
        }
        if (keyName(node) !== "SKIP_TENANT_CHECK" || !isTrue(node.value)) return;
        const reason = reasonAbove({
          comments: commentsOf(program),
          text: context.sourceCode.text,
          offset: node.start,
        });
        if (!reasonIsReal(reason)) context.report({ node, messageId: "missingReason" });
      },
      Literal(node) {
        if (typeof node.value === "string" && RETIRED_COMMENT.test(node.value)) {
          context.report({ node, messageId: "retiredTenancyComment" });
        }
      },
      TemplateElement(node) {
        if (RETIRED_COMMENT.test(node.value?.raw ?? "")) {
          context.report({ node, messageId: "retiredTenancyComment" });
        }
      },
    };
  },
});
