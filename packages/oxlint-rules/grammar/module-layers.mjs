// The closed layer grammar of a module's process package, as tables.
// A repository takes the store it reads, a channel the client it speaks to, a
// transport declares and calls the module. A service works over repository
// and channel interfaces, never the implementation below one. ARCHITECTURE.md §3.2, §8.

/** What a layer may value-import, by folder. A known folder absent from a row is a crossing. */
export const LAYER_MAY_TAKE = {
  channels: ["channels", "rules"],
  repositories: ["repositories", "rules"],
};

/** Folders a layer never names, not even as a type. */
export const LAYER_NEVER_NAMES = {
  transport: ["channels", "repositories", "services"],
};

/** Folders a layer may name only at their top, where the interfaces sit, even as a type. */
export const LAYER_TAKES_INTERFACES_OF = {
  services: ["channels", "repositories"],
};

/** How a crossed layer is named in a message. A folder absent here is not a layer. */
export const LAYER_NOUN = {
  app: "the app",
  channels: "a channel",
  eventing: "the eventing pipeline",
  repositories: "a repository",
  rules: "a rules module",
  services: "a service",
  tasks: "a task",
  transport: "a transport",
};

/** How the implementation below an interface folder is named in a message. */
export const BACKEND_NOUN = {
  channels: "a channel implementation",
  repositories: "a repository backend",
};

function normalise(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** The path below `src/` a specifier lands on, or undefined for a package. */
export function targetPath({ sourcePath, specifier }) {
  if (specifier.startsWith("#")) return specifier.slice(1);
  if (!specifier.startsWith(".")) return undefined;

  const directory = sourcePath.slice(0, sourcePath.lastIndexOf("/"));
  return normalise(`${directory}/${specifier}`);
}

/** The folder below `src/` a specifier lands in, or undefined for a package. */
export function targetLayer({ sourcePath, specifier }) {
  return targetPath({ sourcePath, specifier })?.split("/")[0];
}

/** Whether the layers table governs a layer at all. */
export function isGovernedLayer(layer) {
  if (!layer) return false;

  return (
    layer in LAYER_MAY_TAKE || layer in LAYER_NEVER_NAMES || layer in LAYER_TAKES_INTERFACES_OF
  );
}

/** A crossing whatever the import binds: a refused folder, or a backend below an interface. */
function namedCrossing({ layer, path }) {
  const segments = path.split("/");
  const folder = segments[0];
  if (LAYER_NEVER_NAMES[layer]?.includes(folder)) return LAYER_NOUN[folder];
  const below = segments.length > 2;

  return below && LAYER_TAKES_INTERFACES_OF[layer]?.includes(folder)
    ? BACKEND_NOUN[folder]
    : undefined;
}

function rowCrossing({ layer, target, specifier }) {
  const row = LAYER_MAY_TAKE[layer];
  if (!row || target === layer || row.includes(target)) return undefined;
  if (layer === "repositories" && isEventingStore({ specifier, target })) return undefined;

  return LAYER_NOUN[target];
}

/** What an import crosses into, or undefined when the layer may take it. */
export function layerCrossing({ layer, sourcePath, specifier, typeOnly }) {
  const path = targetPath({ sourcePath, specifier });
  if (!path) return undefined;

  const named = namedCrossing({ layer, path });
  if (named || typeOnly) return named;

  return rowCrossing({ layer, target: path.split("/")[0], specifier });
}

// Event sourcing keeps a store in `eventing/` beside the pipeline naming it, so
// a repository may name a `*.store.ts` there; any other eventing artifact is a
// real crossing and still reports.
function isEventingStore({ specifier, target }) {
  return target === "eventing" && specifier.endsWith(".store.ts");
}
