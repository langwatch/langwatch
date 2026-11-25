export type JsRuntime = "node" | "deno" | "bun" | "web" | "unknown";

let _runtime: JsRuntime | undefined;

/**
 * Gets the cached JavaScript runtime environment.
 * @returns The detected runtime environment
 */
export const getRuntime = (): JsRuntime => {
  _runtime ??= detectRuntime();
  return _runtime;
};

/**
 * Resets the cached runtime. Only used for testing.
 * @internal
 */
export const resetRuntimeCache = (): void => {
  _runtime = undefined;
};

/**
 * Detects the JavaScript runtime environment.
 * @param globals - (Test only) Override the global object for environment simulation;
 *   only used if NODE_ENV === 'test'.
 */
export function detectRuntime(globals?: object): JsRuntime {
  let g: object = globalThis;
  if (globals) {
    if (process.env.NODE_ENV === "test") {
      g = globals;
    } else {
      console.warn(
        "[LangWatch Observability] overriding detectRuntime is only supported when running in NODE_ENV=test",
      );
    }
  }

  try {
    if (isDenoRuntime(g)) return "deno";
    if (isBunRuntime(g)) return "bun";
    if (isNodeRuntime(g)) return "node";
    if (isWebRuntime(g)) {
      return "web";
    }
    return "unknown";
  } catch (error) {
    console.warn("[LangWatch Observability] Failed to detect runtime", error);
    return "unknown";
  }
}

function isWebRuntime(g: object): boolean {
  if (!("window" in g) || typeof g.window !== "object" || !g.window) {
    return false;
  }
  const win: object = g.window;
  if (g !== win) return false;
  return "document" in win && typeof win.document !== "undefined";
}

function isDenoRuntime(g: object): boolean {
  if (!("Deno" in g) || typeof g.Deno !== "object" || !g.Deno) {
    return false;
  }
  return "version" in g.Deno && typeof g.Deno.version === "object";
}

function isBunRuntime(g: object): boolean {
  if (!("Bun" in g) || typeof g.Bun !== "object" || !g.Bun) {
    return false;
  }
  return "version" in g.Bun && typeof g.Bun.version === "string";
}

function isNodeRuntime(g: object): boolean {
  if (!("process" in g) || typeof g.process !== "object" || !g.process) {
    return false;
  }
  const versions: unknown = "versions" in g.process ? g.process.versions : undefined;
  return (
    typeof versions === "object" &&
    versions !== null &&
    "node" in versions &&
    typeof versions.node === "string"
  );
}
