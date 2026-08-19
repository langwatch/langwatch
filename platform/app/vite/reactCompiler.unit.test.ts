/**
 * The React Compiler pass, asserted where it is actually wired.
 *
 * The compiler was enabled under Next.js and lost in the migration to Vite
 * (#3170) with nothing failing. So this reads the real vite config rather than
 * a fixture, and runs the real preset through Babel rather than asserting the
 * config's source text — a string check would have passed for the entire
 * period the compiler was not running.
 *
 * Spec: specs/setup/react-compiler.feature
 */
import { transformAsync } from "@babel/core";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config";

const BABEL_PLUGIN_NAME = "@rolldown/plugin-babel";

/**
 * The config's plugin list, flattened and settled. Vite accepts nested arrays
 * and promises in `plugins`, and the compiler pass is one of the promises.
 */
const resolvedPluginNames = async (): Promise<string[]> => {
  const config = await viteConfig({ command: "build", mode: "production" });
  const plugins = await Promise.all((config.plugins ?? []).flat(Infinity));
  return plugins
    .filter((plugin): plugin is Plugin => !!plugin && "name" in plugin)
    .map((plugin) => plugin.name);
};

/** Runs the preset the vite config ships, over one component's source. */
const compile = async (source: string): Promise<string> => {
  const preset = reactCompilerPreset();
  const result = await transformAsync(source, {
    filename: "Component.tsx",
    presets: [preset.preset()],
    parserOpts: { plugins: ["jsx", "typescript"] },
    configFile: false,
    babelrc: false,
  });
  return result?.code ?? "";
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
      expect(await resolvedPluginNames()).toContain(BABEL_PLUGIN_NAME);
    });
  });

  describe("given a component that derives a value on every render", () => {
    /** @scenario "A component is memoized without anyone writing a hook" */
    it("caches the derived value across renders", async () => {
      const compiled = await compile(A_COMPILABLE_COMPONENT);

      expect(compiled).toContain("react/compiler-runtime");
      expect(A_COMPILABLE_COMPONENT).not.toContain("useMemo");
    });
  });

  describe("when a component breaks the rules of React", () => {
    /** @scenario "Code the compiler cannot prove is left as it was written" */
    it("leaves it uncompiled instead of failing the build", async () => {
      const compiled = await compile(A_COMPONENT_THAT_BREAKS_THE_RULES);

      expect(compiled).not.toContain("react/compiler-runtime");
      expect(compiled).toContain("useState(spans.length)");
    });
  });
});
