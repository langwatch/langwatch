/**
 * Preload hook for profile-startup.mjs — times every CommonJS module load.
 *
 * Patches `Module._load` so each real (non-cached) load becomes a timed frame
 * with a parent link to the frame that triggered it. At process exit the
 * aggregated tree is written as JSON to the path in
 * `LANGWATCH_STARTUP_TREE_OUT`.
 *
 * Because the CLI ships as a single tsup bundle, this hook sees only the
 * EXTERNAL requires (node builtins and the deps tsup leaves external:
 * commander, chalk, dotenv, …). The in-bundle cost is visible in the CPU
 * profile half of the tooling, which is function-granular.
 */
"use strict";

const Module = require("node:module");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");

const originalLoad = Module._load;
const originalResolveFilename = Module._resolveFilename;

/** Flat aggregates keyed by module id: { self, total, count, parents: Map<parentId, count> } */
const aggregates = new Map();
/** First-seen parent per module, for the nested tree rendering. */
const firstParent = new Map();
/** Load order, so the tree rendering is stable. */
const order = [];
/** Active frame stack; each frame: { id, start, childTime }. */
const stack = [];

const nodeBootMs = performance.now(); // time from preload start (≈ post-boot)

const record = (id, elapsed) => {
  const parent = stack[stack.length - 1];
  if (parent) parent.childTime += elapsed;

  let agg = aggregates.get(id);
  if (!agg) {
    agg = { id, self: 0, total: 0, count: 0, parents: new Map() };
    aggregates.set(id, agg);
    order.push(id);
  }
  agg.total += elapsed;
  agg.self += elapsed; // child subtraction happens via childTime below
  agg.count += 1;
  const parentId = parent ? parent.id : "(root)";
  agg.parents.set(parentId, (agg.parents.get(parentId) ?? 0) + 1);
  if (!firstParent.has(id)) firstParent.set(id, parentId);
};

Module._load = function (request, parent, isMain) {
  let id = request;
  try {
    id = originalResolveFilename.call(this, request, parent, isMain);
  } catch {
    // Unresolvable (optional dep probed by a try/catch) — record by request.
  }

  // Cached loads return in microseconds; recording them is pure noise.
  if (Module._cache[id]) return originalLoad.call(this, request, parent, isMain);

  const frame = { id, start: performance.now(), childTime: 0 };
  stack.push(frame);
  try {
    return originalLoad.call(this, request, parent, isMain);
  } finally {
    stack.pop();
    const elapsed = performance.now() - frame.start;
    frame.self = elapsed - frame.childTime;
    record(id, elapsed);
    // Correct self time: subtract this frame's children from its own total.
    const agg = aggregates.get(id);
    agg.self -= frame.childTime;
  }
};

const buildTree = () => {
  const childrenOf = new Map(); // parentId -> [childId]
  for (const id of order) {
    const parentId = firstParent.get(id) ?? "(root)";
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(id);
  }
  const toNode = (id) => {
    const agg = aggregates.get(id);
    return {
      id,
      totalMs: round(agg.total),
      selfMs: round(agg.self),
      count: agg.count,
      children: (childrenOf.get(id) ?? []).map(toNode),
    };
  };
  return (childrenOf.get("(root)") ?? []).map(toNode);
};

const round = (n) => Math.round(n * 1000) / 1000;

process.on("exit", () => {
  const out = process.env.LANGWATCH_STARTUP_TREE_OUT;
  if (!out) return;
  const flat = order.map((id) => {
    const agg = aggregates.get(id);
    return {
      id,
      totalMs: round(agg.total),
      selfMs: round(agg.self),
      count: agg.count,
      parents: Object.fromEntries(agg.parents),
    };
  });
  const payload = {
    nodeBootMs: round(nodeBootMs),
    moduleCount: order.length,
    tree: buildTree(),
    flat,
  };
  try {
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  } catch (error) {
    process.stderr.write(`startup-require-hook: cannot write ${out}: ${error}\n`);
  }
});
