import { defineModuleVitestConfig } from "@langwatch/vitest-config";

const config = defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    fsModuleCache: true,
    watch: false,
    testTimeout: 10000,
  },
});

export default {
  ...config,
  // Typechecking owns project references; test transforms only strip this package's types.
  oxc: { tsconfig: { compilerOptions: { verbatimModuleSyntax: true } } },
};
