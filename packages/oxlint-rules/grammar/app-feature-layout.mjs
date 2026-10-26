// The app-features layout: an application that is not a module host (the
// public docs site) splits its `src/` into features, each a folder of four
// layers, plus shared leaves and the composition that assembles them. The
// rule `app-feature-layout` reads these tables; ADR-137 holds the decision.

/** The `package.json` value an application opts into this layout with. */
export const APP_FEATURE_LAYOUT = "app-features";

/**
 * What a layer may import, from its own feature or from a declared dependency's
 * entry. `compile` never takes `ui`: rendering a component at build time is the
 * composition's job (`app/`, `site/`), so build code stays plain Node.
 */
export const APP_LAYER_MAY_TAKE = {
  browser: ["browser", "model"],
  compile: ["compile", "model"],
  model: ["model"],
  ui: ["model", "ui"],
};

/** How a layer is named in a message. */
export const APP_LAYER_NOUN = {
  browser: "a browser island",
  compile: "build-time code",
  model: "the model",
  ui: "a component",
};

/** Top-level folders of `src/` that compose features; they import any layer's entry. */
export const APP_COMPOSITION_ROOTS = new Set(["app", "browser", "site", "testing"]);

/** Top-level folders of `src/` every place may import; they import only each other. */
export const APP_LEAF_ROOTS = new Set(["lib"]);

const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const ANY_EXTENSION = /\.[a-z0-9]+$/i;

/** Whether a manifest opts its application in: `"langwatch": { "layout": "app-features" }`. */
export function optsIntoAppFeatureLayout(manifest) {
  return manifest?.langwatch?.layout === APP_FEATURE_LAYOUT;
}

/** The declared feature graph, `"langwatch": { "features": { name: [dependency, ...] } }`. */
export function declaredFeatures(manifest) {
  const features = manifest?.langwatch?.features ?? {};

  return new Map(Object.entries(features).map(([name, needs]) => [name, [...(needs ?? [])]]));
}

function markCycle({ cycles, cycle }) {
  for (const member of cycle.slice(0, -1)) if (!cycles.has(member)) cycles.set(member, cycle);
}

/** Each feature that sits on a cycle of the declared graph, with one cycle through it. */
export function cyclesOf(features) {
  const cycles = new Map();
  const walk = (path) => {
    for (const next of features.get(path.at(-1)) ?? []) {
      const at = path.indexOf(next);
      if (at === -1) walk([...path, next]);
      else markCycle({ cycles, cycle: [...path.slice(at), next] });
    }
  };
  for (const name of features.keys()) walk([name]);

  return cycles;
}

/**
 * Where a path below `src/` sits: a feature layer, a feature's entry
 * (`features/<name>/<layer>.ts`), a leaf, the composition, or nowhere known.
 */
export function placeOf(sourcePath) {
  const parts = sourcePath.split("/");
  if (parts[0] === "features") return featurePlaceOf(parts);
  if (parts.length === 1) return { area: "leaf" };
  if (APP_LEAF_ROOTS.has(parts[0])) return { area: "leaf" };
  if (APP_COMPOSITION_ROOTS.has(parts[0])) return { area: "composition" };

  return { area: "unknown", folder: parts[0] };
}

function featurePlaceOf(parts) {
  const [, feature, second] = parts;
  if (!feature || !second) return { area: "unknown", folder: parts.join("/") };
  if (parts.length === 3) {
    const layer = second.replace(MODULE_EXTENSION, "");
    if (layer in APP_LAYER_MAY_TAKE && layer !== second) return { area: "entry", feature, layer };
  }
  if (parts.length > 3 && second in APP_LAYER_MAY_TAKE) {
    return { area: "feature", feature, layer: second };
  }

  return { area: "unknown", folder: parts.slice(0, 3).join("/") };
}

function normalise(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(part);
  }

  return parts.join("/");
}

/** The path below `src/` a relative module specifier lands on; undefined for a package or an asset. */
export function appTargetPath({ sourcePath, specifier }) {
  if (!specifier.startsWith(".")) return undefined;
  const path = specifier.split("?")[0];
  if (ANY_EXTENSION.test(path) && !MODULE_EXTENSION.test(path)) return undefined;
  const directory = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1);

  return normalise(`${directory}${path}`);
}

function featureCrossing({ from, needs, to }) {
  if (to.area !== "entry") return { messageId: "internalReach" };
  if (!needs.includes(to.feature)) return { messageId: "undeclaredDependency" };
  if (!APP_LAYER_MAY_TAKE[from.layer].includes(to.layer)) return { messageId: "layerCrossing" };

  return undefined;
}

/**
 * What an import from `from` to `to` breaks, as a message id, or undefined.
 * `needs` is the importing feature's declared dependencies.
 */
export function appImportCrossing({ from, needs = [], to }) {
  if (to.area === "unknown") return undefined;
  if (from.area === "leaf") return to.area === "leaf" ? undefined : { messageId: "leafReachesUp" };
  if (from.area === "composition") {
    return to.area === "feature" ? { messageId: "internalReach" } : undefined;
  }
  if (from.area !== "feature") return undefined;
  if (to.area === "composition") return { messageId: "reachesComposition" };
  if (to.area === "leaf") return undefined;
  if (to.feature !== from.feature) return featureCrossing({ from, needs, to });
  if (to.area === "entry") return { messageId: "ownEntry" };

  return APP_LAYER_MAY_TAKE[from.layer].includes(to.layer)
    ? undefined
    : { messageId: "layerCrossing" };
}
