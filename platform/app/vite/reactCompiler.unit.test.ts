/**
 * The React Compiler pass, asserted where it is actually wired.
 *
 * The compiler was enabled under Next.js and lost in the migration to Vite
 * (#3170) with nothing failing. So this reads the real vite config rather than
 * a fixture, and drives the pass that config produces rather than asserting the
 * config's source text — a string check would have passed for the entire period
 * the compiler was not running.
 *
 * Every scenario here goes through `compileThroughTheBuild`, which looks the
 * pass up in the resolved config first. Calling `oxc-transform-react` directly
 * would be easier and would prove nothing: its compiler is on by default, so
 * those assertions would stay green with the build wired to skip it entirely.
 *
 * Spec: specs/setup/react-compiler.feature
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config";

/**
 * The components that call `reset()`, so a memoized registration in any of them
 * silently drops what the user types. The e2e covers the scenario editor; these
 * are the rest, which nothing else would catch.
 *
 * Kept as paths rather than a glob: a glob that stopped matching would leave
 * this asserting nothing at all.
 */
const FORMS_THAT_RESET = [
  "src/components/scenarios/ScenarioForm.tsx",
  "src/components/settings/ChangePasswordDialog.tsx",
  "src/components/projects/ProjectForm.tsx",
  "src/components/annotations/AnnotationComment.tsx",
  "src/components/evaluators/EvaluatorEditorShared.tsx",
  "src/optimization_studio/components/properties/AgentPropertiesPanel.tsx",
  "src/prompts/forms/ChangeHandleDialog.tsx",
  "src/prompts/forms/SaveVersionDialog.tsx",
];

const COMPILER_PLUGIN_NAME = "vite:react-compiler";

/**
 * Hand-rolled rather than `Array.prototype.flat(Infinity)`, whose return type
 * recurses until the compiler gives up with TS2589.
 */
const flatten = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.flatMap(flatten) : [value];

const isPlugin = (value: unknown): value is Plugin =>
  typeof value === "object" && value !== null && "name" in value;

/**
 * The config's plugin list, flattened and settled. Vite accepts nested arrays
 * and promises in `plugins`.
 */
const resolvedPlugins = async (): Promise<Plugin[]> => {
  const config = await viteConfig({ command: "build", mode: "production" });
  const plugins = await Promise.all(flatten(config.plugins ?? []));
  return plugins.filter(isPlugin);
};

/**
 * What the plugin calls on itself while transforming. `error` throws so that a
 * diagnostic the compiler escalates fails the test rather than passing quietly
 * — that escalation is the failure mode the bail-out scenario rules out.
 */
interface RecordingContext {
  environment: undefined;
  error(reason: unknown): never;
  warn(reason: unknown): void;
}

/**
 * Vite lets a hook be a bare function or `{ handler }`. Accept both.
 *
 * Takes `unknown` because vite types each hook's `this` as its own plugin
 * context, and we are deliberately calling them with a stub that records
 * instead of one vite built.
 */
const handlerOf = <T>({
  hook,
  hookName,
}: {
  hook: unknown;
  hookName: string;
}): T => {
  if (hook === undefined) {
    throw new Error(`${COMPILER_PLUGIN_NAME} has no ${hookName} hook`);
  }
  return (
    typeof hook === "object" && hook !== null && "handler" in hook
      ? hook.handler
      : hook
  ) as T;
};

type ConfigHook = (
  this: RecordingContext,
  config: Record<string, unknown>,
  env: { command: string; mode: string },
) => unknown;

type TransformHook = (
  this: RecordingContext,
  code: string,
  id: string,
) => Promise<{ code?: string } | string | null | undefined>;

/**
 * Runs one component's source through the compiler pass the build runs, and
 * reports what the pass said about it.
 */
const compileThroughTheBuild = async (
  source: string,
): Promise<{ code: string; warnings: string[] }> => {
  const plugin = (await resolvedPlugins()).find(
    (candidate) => candidate.name === COMPILER_PLUGIN_NAME,
  );
  if (!plugin) {
    throw new Error(`the build runs no ${COMPILER_PLUGIN_NAME} pass`);
  }

  const warnings: string[] = [];
  const context: RecordingContext = {
    environment: undefined,
    error(reason) {
      throw new Error(String(reason));
    },
    warn(reason) {
      warnings.push(
        String(
          reason && typeof reason === "object" && "message" in reason
            ? reason.message
            : reason,
        ),
      );
    },
  };

  // Loads the native compiler the transform then uses.
  await handlerOf<ConfigHook>({ hook: plugin.config, hookName: "config" }).call(
    context,
    {},
    { command: "build", mode: "production" },
  );

  const result = await handlerOf<TransformHook>({
    hook: plugin.transform,
    hookName: "transform",
  }).call(context, source, "/src/TotalCost.tsx");

  return {
    code: typeof result === "string" ? result : (result?.code ?? ""),
    warnings,
  };
};

const A_COMPILABLE_COMPONENT = `
  export function TotalCost({ spans }) {
    const total = spans.reduce((sum, span) => sum + span.cost, 0);
    return <span>{total}</span>;
  }
`;

/**
 * A hook called inside a branch. The compiler cannot reason about a component
 * whose hook order varies, so it declines this one — which is the bail-out
 * this asserts, rather than an error that would stop the build.
 */
const A_COMPONENT_THAT_BREAKS_THE_RULES = `
  export function TotalCost({ spans, ready }) {
    if (ready) {
      const [seen] = useState(spans.length);
      return <span>{seen}</span>;
    }
    return null;
  }
`;

describe("the React Compiler pass", () => {
  describe("given the vite config the application builds with", () => {
    /** @scenario "The build compiles the frontend" */
    it("includes the compiler pass in the plugins the build runs", async () => {
      const names = (await resolvedPlugins()).map((plugin) => plugin.name);

      expect(names).toContain(COMPILER_PLUGIN_NAME);
    });
  });

  describe("given a component that derives a value on every render", () => {
    /** @scenario "A component is memoized without anyone writing a hook" */
    it("compiles it with memoization slots it never asked for", async () => {
      const { code, warnings } = await compileThroughTheBuild(
        A_COMPILABLE_COMPONENT,
      );

      // The cache slots are the memoization: `_c(n)` reserves them, and the
      // runtime import is what reads them back on the next render.
      expect(code).toMatch(/_c\(\d+\)/);
      expect(code).toContain("react/compiler-runtime");
      expect(warnings).toEqual([]);
    });
  });

  describe("given the form components that re-seed themselves", () => {
    /** @scenario "A form that re-seeds itself still records what the user types" */
    it("compiles none of them with a memoized field registration", async () => {
      const offenders: string[] = [];

      for (const relativePath of FORMS_THAT_RESET) {
        const source = await readFile(
          resolve(import.meta.dirname, "..", relativePath),
          "utf8",
        );
        const { code } = await compileThroughTheBuild(source);
        // The shape that breaks: the compiler caching a `register()` call,
        // keyed on `register` — which never changes, so it never re-runs.
        if (/\$\[\d+\]\s*!==\s*(\w+\.)?register\b/.test(code)) {
          offenders.push(relativePath);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("when a component breaks the rules of React", () => {
    /** @scenario "Code the compiler cannot prove is left as it was written" */
    it("leaves it uncompiled and reports it instead of failing the build", async () => {
      const { code, warnings } = await compileThroughTheBuild(
        A_COMPONENT_THAT_BREAKS_THE_RULES,
      );

      expect(code).not.toContain("react/compiler-runtime");
      expect(code).toContain("useState(spans.length)");
      // Reported, not thrown: the build keeps going without this component's
      // optimization. `context.error` throws, so an escalated diagnostic would
      // have failed this test before reaching the assertions.
      expect(warnings.join("\n")).toContain(
        "Hooks must always be called in a consistent order",
      );
    });
  });
});
