import { defineConfig } from "vitest/config";

/**
 * Only `src/lib` is covered here. Those modules are deliberately free of any
 * React Native import — instance-URL parsing, formatting, ordering, the
 * confirmation gate — so they run under plain node with no native shims and no
 * jest-expo transform pipeline. Anything that renders a component needs
 * jest-expo instead; see README.
 */
export default defineConfig({
  test: {
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
  },
});
