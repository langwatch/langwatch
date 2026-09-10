// The closed layer grammar of a module's server package, as one table.
//
// A service takes other services and the module's own repositories and
// channels. A repository takes the store it reads. A channel takes the client
// it speaks to. Nothing takes what sits above it, and nothing reaches into
// another module's server package: outside its own package a module is its
// App, named through the contract's `<F>Api` token.

/** What a layer may name, by folder. A folder absent from a row is a crossing. */
export const LAYER_MAY_TAKE = {
  channels: ["channels", "rules"],
  repositories: ["repositories", "rules"],
  services: ["channels", "repositories", "rules", "services"],
};

/** How a crossed layer is named in a message. */
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

function normalise(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** The folder below `src/` a specifier lands in, or undefined for a package. */
export function targetLayer({ sourcePath, specifier }) {
  if (specifier.startsWith("#")) return specifier.slice(1).split("/")[0];
  if (!specifier.startsWith(".")) return undefined;

  const directory = sourcePath.slice(0, sourcePath.lastIndexOf("/"));
  return normalise(`${directory}/${specifier}`).split("/")[0];
}

/** The layer a file sits in, or undefined when it sits outside the table. */
export function layerOf(sourcePath) {
  const folder = sourcePath?.split("/")[0];
  return folder && folder in LAYER_MAY_TAKE ? folder : undefined;
}

/**
 * The layer this import crosses into, or undefined when the import is allowed.
 * A specifier naming another module's server package always crosses.
 */
export function crossingFor({ layer, sourcePath, specifier }) {
  if (/^@langwatch\/[a-z0-9-]+-server(?:\/|$)/.test(specifier)) return "another module";

  const target = targetLayer({ sourcePath, specifier });
  if (!target || target === layer) return undefined;

  return LAYER_MAY_TAKE[layer].includes(target) ? undefined : (LAYER_NOUN[target] ?? undefined);
}
