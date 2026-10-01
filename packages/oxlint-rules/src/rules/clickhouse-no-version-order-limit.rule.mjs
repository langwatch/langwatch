import { defineRule } from "../define-rule.mjs";
import { isClickHouseRepository, queryTextVisitor } from "./clickhouse-query-text.mjs";

// dev/docs/best_practices/clickhouse-queries.md, Anti-Pattern 1: sorting every
// unmerged version of a row by its version column loads each heavy payload
// before LIMIT 1 discards all but one.

const HEAVY_COLUMN =
  /\b(?:Messages|ComputedInput|ComputedOutput|Inputs|Details|SpanAttributes|RoleCosts|Metadata)\b/;
const VERSION_ORDER_LIMIT =
  /\bORDER\s+BY\s+(?:\w+\.)?(\w*(?:Version|UpdatedAt))\s+DESC\s+LIMIT\s+1\b/;

export const clickhouseNoVersionOrderLimitRule = defineRule({
  name: "clickhouse-no-version-order-limit",
  kind: "problem",
  applies: isClickHouseRepository,
  messages: {
    versionOrderLimit: {
      what: "This ClickHouse query reads heavy columns and picks the latest version with `ORDER BY {{column}} DESC LIMIT 1`, which loads every unmerged version before discarding them.",
      why: "The sort runs over full rows, not over the key columns.",
      fix: "Select the latest version with an IN-tuple dedup: key columns and `max({{column}})` in an inner GROUP BY, heavy columns only in the outer SELECT.",
    },
  },
  create(context) {
    return queryTextVisitor(context, (node, text) => {
      const order = VERSION_ORDER_LIMIT.exec(text);
      if (!order || !HEAVY_COLUMN.test(text)) return;
      context.report({ node, messageId: "versionOrderLimit", data: { column: order[1] } });
    });
  },
});
