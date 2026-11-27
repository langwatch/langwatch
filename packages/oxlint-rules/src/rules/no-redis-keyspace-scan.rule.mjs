import { defineRule } from "../define-rule.mjs";

// packages/group-queue/adrs/092-tenant-claims-index.md: a SCAN reads every key
// in Redis whatever MATCH says, so a live path must read an index instead.

const SCAN_OPTION = /^(?:MATCH|COUNT)$/i;

/** Budgeted, operator-paced walks, each with its reason. */
const PACED_WALKS = new Map([
  ["packages/group-queue/src/blobSweeper.ts", "2,000 calls per tick, resumable cursor"],
  ["packages/group-queue/src/tenantClaims.ts", "the one-time paced backfill (ADR-092)"],
  ["packages/group-queue/src/drainAudit.ts", "operator-started audit"],
  ["packages/group-queue/src/tasks/reap-stranded-groups.task.ts", "operator task"],
  [
    "modules/ops/process/src/repositories/redis/queue.repository.ts",
    "dashboard fallback once; reconcile only when due",
  ],
  [
    "modules/ops/process/src/repositories/redis/redis.blob-store.repository.ts",
    "paged, call budget",
  ],
]);

function isLivePath(file) {
  return !file.isTest && !PACED_WALKS.has(file.workspacePath);
}

const SCAN_METHODS = new Set(["scan", "scanBuffer"]);
const WALK_METHODS = new Set(["scanStream", "scanBufferStream", "scanIterator"]);
const REDIS_RECEIVER = /redis|connection|client|cluster|node/i;
const CURSOR_START = new Set(["0", 0]);
const GLOB = /[*?[]/;
const LUA_WALK = /redis\.p?call\(\s*["'](SCAN|KEYS)["']/i;

function methodName(callee) {
  if (callee.type !== "MemberExpression") return undefined;
  const { property } = callee;
  if (!callee.computed) return property.type === "Identifier" ? property.name : undefined;
  return property.type === "Literal" && typeof property.value === "string"
    ? property.value
    : undefined;
}

/** The receiver's own name: `redis` in `redis.scan`, `this.redis.scan` and `a.redis.scan`. */
function receiverName(callee) {
  const { object } = callee;
  if (object.type === "Identifier") return object.name;
  if (object.type === "MemberExpression" && object.property.type === "Identifier") {
    return object.property.name;
  }
  return "";
}

function staticString(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? "";
  }
  return undefined;
}

function isScanOption(arg) {
  const text = staticString(arg);
  if (text !== undefined) return SCAN_OPTION.test(text);
  return (
    arg.type === "ObjectExpression" &&
    arg.properties.some(
      (prop) =>
        prop.type === "Property" &&
        ((prop.key.type === "Identifier" && SCAN_OPTION.test(prop.key.name)) ||
          (prop.key.type === "Literal" && SCAN_OPTION.test(String(prop.key.value)))),
    )
  );
}

function walksKeyspace({ method, callee, args }) {
  if (WALK_METHODS.has(method)) return true;
  const fromRedis = REDIS_RECEIVER.test(receiverName(callee));
  if (SCAN_METHODS.has(method)) {
    const first = args[0];
    const startsAtCursor = first?.type === "Literal" && CURSOR_START.has(first.value);
    return args.some(isScanOption) || startsAtCursor || (fromRedis && args.length > 0);
  }
  if (method === "keys" && args.length > 0) {
    const pattern = staticString(args[0]);
    return fromRedis || (pattern !== undefined && GLOB.test(pattern));
  }
  return false;
}

export const noRedisKeyspaceScanRule = defineRule({
  name: "no-redis-keyspace-scan",
  kind: "problem",
  applies: isLivePath,
  messages: {
    keyspaceScan: {
      what: "`.{{method}}(...)` walks the Redis keyspace on a live path.",
      why: "A SCAN reads every key in Redis whatever MATCH says.",
      fix: "Keep an index the owner writes (ADR-092) or add a budgeted, paced walk to the allowlist in no-redis-keyspace-scan with its reason.",
    },
    luaKeyspaceScan: {
      what: "A Lua script calls {{command}}, which walks the Redis keyspace on a live path.",
      why: "SCAN and KEYS read every key in Redis whatever the pattern says, and a script blocks Redis while it runs.",
      fix: "Keep an index the owner writes (ADR-092) and read that set in the script instead.",
    },
  },
  create(context) {
    const reportLua = (node, text) => {
      const match = LUA_WALK.exec(text);
      if (match) {
        context.report({
          node,
          messageId: "luaKeyspaceScan",
          data: { command: match[1].toUpperCase() },
        });
      }
    };
    return {
      CallExpression(node) {
        const method = methodName(node.callee);
        if (method && walksKeyspace({ method, callee: node.callee, args: node.arguments })) {
          context.report({ node, messageId: "keyspaceScan", data: { method } });
        }
      },
      Literal(node) {
        if (typeof node.value === "string") reportLua(node, node.value);
      },
      TemplateLiteral(node) {
        reportLua(node, node.quasis.map((quasi) => quasi.value.raw).join(""));
      },
    };
  },
});
