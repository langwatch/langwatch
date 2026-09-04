import { type FS, Liquid, type LiquidOptions } from "liquidjs";

/**
 * The Liquid engine every customer-authored template is rendered by.
 *
 * liquidjs defaults to the node file system rooted at `["."]`, so `{% render
 * 'x' %}` and `{% include 'x' %}` read files under the process working
 * directory and inline them into whatever the template is used to build — a
 * request body, a prompt, a notification. Nothing we render legitimately
 * includes a file, so the engine is given a file system that refuses.
 */

const FILE_ACCESS_REFUSED = "Templates cannot read files: file inclusion is disabled.";

function refuse(): never {
  throw new Error(FILE_ACCESS_REFUSED);
}

/**
 * A file system that answers "no such file" to every lookup and throws on every
 * read, so a refusal cannot depend on `root` being set correctly as well.
 */
const NO_FILE_ACCESS: FS = {
  exists: async () => false,
  existsSync: () => false,
  readFile: async () => refuse(),
  readFileSync: () => refuse(),
  resolve: (_dir: string, file: string) => file,
  contains: async () => false,
  containsSync: () => false,
  dirname: () => "",
  sep: "/",
};

/**
 * Builds an engine with file inclusion off, keeping the caller's own options.
 * The file-system options are applied last: they are not the caller's to relax.
 */
export function createSandboxedLiquid(options: LiquidOptions = {}): Liquid {
  return new Liquid({
    ...options,
    fs: NO_FILE_ACCESS,
    root: [],
    partials: [],
    layouts: [],
    relativeReference: false,
    dynamicPartials: false,
  });
}
