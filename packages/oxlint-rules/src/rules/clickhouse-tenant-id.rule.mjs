import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  cteNamesInFile,
  isClickHouseRepository,
  queryTextVisitor,
  tableScopesOf,
  withArgumentsOf,
} from "./clickhouse-query-text.mjs";

// dev/docs/best_practices/clickhouse-queries.md "TenantId is Always Required":
// no id but TenantId is unique across tenants, so every table a query reads
// or mutates carries a TenantId predicate in its own scope. System tables and
// the organization-scoped billing ledger are the documented carve-outs.

const TENANT_PREDICATE =
  /\b(?:TenantId|tenant_id|project_id|ProjectId)\s*(?:=|IN\b)\s*\(?\s*(?:\{\s*\w+\s*:|\$\{[^}]*\}(?!\s*\.))/gi;
const ORGANIZATION_PREDICATE = /\bOrganizationId\s*=\s*\{organizationId:String\}/g;
const DELEGATED_WHERE = /\b(?:PRE)?WHERE\s+\$\{|\$\{[\w.$]*where[\w.$]*\u2026?\}/gi;
const TENANT_CORRELATION = /\bTenantId\s*=\s*(?:\w+|\$\{[^}]*\})\.TenantId\b/g;
const FUNCTION = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);
const SYSTEM_TABLE = /^system\./;
const ORGANIZATION_LEDGER = /^(?:metric_usage_estimates|\$\{[\w.$]*USAGE_ESTIMATES[\w.$]*\})$/i;

function hasPredicateInScope(text, scope, predicate) {
  const segment = text.slice(scope.start, scope.end);
  for (const match of segment.matchAll(predicate)) {
    if (scope.depths[scope.start + match.index] === scope.depth) return true;
  }

  return false;
}

function isUnscopedKey(node) {
  return node.type === "Property" && !node.computed && node.key?.name === "unscoped";
}

function objectDeclaresUnscoped(node) {
  return node.type === "ObjectExpression" && node.properties.some(isUnscopedKey);
}

function bodyDeclaresUnscoped(root) {
  let found = false;
  walk(root, (node) => {
    if (found) return false;
    found = isUnscopedKey(node);
  });

  return found;
}

function thisMethodOf(call) {
  const callee = call.callee;
  if (callee?.type !== "MemberExpression" || callee.object?.type !== "ThisExpression")
    return void 0;
  let owner = call.parent;
  while (owner && owner.type !== "ClassBody") owner = owner.parent;

  return owner?.body.find(
    (member) =>
      member.key?.type === callee.property.type && member.key.name === callee.property.name,
  );
}

/** The statement travels with `unscoped: { reason }`, inline or through a method of this class. */
function declaresUnscoped(node) {
  for (
    let current = node.parent;
    current && !FUNCTION.has(current.type);
    current = current.parent
  ) {
    if (objectDeclaresUnscoped(current)) return true;
    if (current.type !== "CallExpression") continue;
    const method = thisMethodOf(current);
    if (method && bodyDeclaresUnscoped(method.value)) return true;
  }

  return false;
}

function isScoped(text, scope) {
  if (SYSTEM_TABLE.test(scope.table)) return true;
  if (hasPredicateInScope(text, scope, TENANT_PREDICATE)) return true;
  if (hasPredicateInScope(text, scope, DELEGATED_WHERE)) return true;
  if (scope.depth > 0 && hasPredicateInScope(text, scope, TENANT_CORRELATION)) return true;

  return (
    ORGANIZATION_LEDGER.test(scope.table) &&
    hasPredicateInScope(text, scope, ORGANIZATION_PREDICATE)
  );
}

export const clickhouseTenantIdRule = defineRule({
  name: "clickhouse-tenant-id",
  kind: "problem",
  applies: isClickHouseRepository,
  messages: {
    missingTenantPredicate: {
      what: "This ClickHouse query reads `{{table}}` without a `TenantId` predicate in that table's own WHERE, so it can return another tenant's rows.",
      why: "No id but TenantId is unique across tenants.",
      fix: "Add `TenantId = {tenantId:String}` (or `TenantId IN {tenantIds:Array(String)}`) to the WHERE that filters `{{table}}`.",
    },
  },
  create(context) {
    let fileCtes;

    return queryTextVisitor(context, (node, text) => {
      if (declaresUnscoped(node)) return;
      fileCtes ??= cteNamesInFile(context);
      for (const scope of tableScopesOf(text, [...fileCtes, ...withArgumentsOf(node)])) {
        if (isScoped(text, scope)) continue;
        context.report({ node, messageId: "missingTenantPredicate", data: { table: scope.table } });
      }
    });
  },
});
