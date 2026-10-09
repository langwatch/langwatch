import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineRule } from "../define-rule.mjs";

// A drain routes jobs a previous release queued under a former pipeline's keys, so it
// lives for one release, as a lane alias does (ARCHITECTURE.md, upcasts, round 16).

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
const newestReleaseCache = new Map();

function parseRelease(release) {
  const match = RELEASE.exec(release);
  return match ? match.slice(1).map(Number) : undefined;
}

function releaseAtOrAfter({ release, floor }) {
  const left = parseRelease(release);
  const right = parseRelease(floor);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }

  return true;
}

/** The newest cut release: the highest `packages/upgrade/releases/<x.y.z>.json`. */
function newestRelease(cwd) {
  if (newestReleaseCache.has(cwd)) return newestReleaseCache.get(cwd);
  const directory = join(cwd, "packages", "upgrade", "releases");
  const releases = existsSync(directory)
    ? readdirSync(directory).flatMap((file) => /^(\d+\.\d+\.\d+)\.json$/.exec(file)?.[1] ?? [])
    : [];
  const newest = releases
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  newestReleaseCache.set(cwd, newest);
  return newest;
}

function propertyNamed(objectExpression, name) {
  return objectExpression.properties?.find(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      (property.key?.name === name || property.key?.value === name),
  );
}

function isWithUpcastsCall(node) {
  const callee = node.callee;
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.name === "withUpcasts"
  );
}

export const upcastDrainWindowRule = defineRule({
  name: "upcast-drain-window",
  kind: "problem",
  applies: (file) => file.isProduction,
  messages: {
    drainWithoutWindow: {
      what: "This upcast drain declares no `removeAfter` release.",
      why: "A drain carries jobs a previous release queued, so it lives for one release and must say which.",
      fix: 'Add `removeAfter: "<next release>"` (a literal `x.y.z`) to the `drain`, as `.withLaneAliases` does. Read the `eventing-and-worker` skill.',
    },
    drainPastWindow: {
      what: "This upcast drain outlived its window: `removeAfter` is {{removeAfter}} and {{newest}} has been cut.",
      why: "Every job the previous release queued has drained by now; the drain is dead routing.",
      fix: "Delete the `drain` from `.withUpcasts`; keep the `events` until their own contract step at the LTS floor. Read the `eventing-and-worker` skill.",
    },
  },
  create(context, _file) {
    return {
      CallExpression(node) {
        if (!isWithUpcastsCall(node)) return;
        const declaration = node.arguments?.[0];
        if (declaration?.type !== "ObjectExpression") return;
        const drain = propertyNamed(declaration, "drain")?.value;
        if (drain?.type !== "ObjectExpression") return;

        const removeAfter = propertyNamed(drain, "removeAfter")?.value;
        const release = removeAfter?.type === "Literal" ? removeAfter.value : undefined;
        if (typeof release !== "string" || !parseRelease(release)) {
          context.report({ node: drain, messageId: "drainWithoutWindow" });
          return;
        }

        const newest = newestRelease(context.cwd);
        if (!newest || !releaseAtOrAfter({ release: newest, floor: release })) return;
        context.report({
          node: drain,
          messageId: "drainPastWindow",
          data: { newest, removeAfter: release },
        });
      },
    };
  },
});
