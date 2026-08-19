import { defineConfig } from "tsup";

/**
 * The session context hook script that ships INSIDE the LangWatch agent plugin
 * (`plugins/langwatch/scripts/session-context.mjs`).
 *
 * A separate config rather than a third entry in tsup.config.ts, because
 * nothing about this output is shared with the published npm tarball: it is
 * built on the plugin's release cadence, not the SDK's, and it is excluded from
 * `files` so `pnpm pack` is byte-for-byte what it was.
 *
 * The output must be ONE file with no imports outside node builtins. It is
 * executed straight from the plugin directory by whatever `node` the user has,
 * with no install step, no node_modules beside it and no package.json above it
 * to declare a module type. So: `.mjs` (which makes it ESM regardless of what
 * directory it lands in), everything inlined, and a build that fails loudly
 * here rather than at the top of somebody's coding session.
 *
 * There is no `target` for the same reason the other two configs have none:
 * tsup takes it from tsconfig.json, which is the one place the SDK's floor is
 * declared.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */
export default defineConfig({
  entry: {
    "plugin/session-context": "src/cli/plugin/session-context-entry.ts",
  },
  format: ["esm"],
  platform: "node",
  // Everything, including zod and the workspace packages the SDK normally
  // leaves for a consumer's installer to resolve. There is no installer here.
  noExternal: [/.*/],
  splitting: false,
  // The other configs write into the same dist/, concurrently during
  // `pnpm build`. Cleaning would race them.
  clean: false,
  minify: true,
  dts: false,
  // No map, and no reference to one. The file is read by nobody and shipped to
  // everybody: a sourcemap comment pointing at a file the plugin does not carry
  // is worse than no comment at all.
  sourcemap: false,
});
