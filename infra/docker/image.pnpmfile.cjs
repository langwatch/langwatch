// Read only by the image's production install (pnpm_config_pnpmfile in the Dockerfile). The root
// has no .pnpmfile.cjs, so a developer install and the lockfile never see this hook.
// A peer that resolves to a dev tool pulls the tool into the image and forks each package that
// declares it into one copy per resolved peer set. No server process runs any of them.
const DEV_TOOL_PEERS = [
  "vitest",
  "vite",
  "rolldown",
  "esbuild",
  "lightningcss",
  "sass",
  "playwright",
  "msw",
  "jsdom",
  "typescript",
  "monaco-editor",
];

module.exports = {
  hooks: {
    readPackage(pkg) {
      for (const name of DEV_TOOL_PEERS) {
        delete pkg.peerDependencies?.[name];
        delete pkg.peerDependenciesMeta?.[name];
      }
      return pkg;
    },
  },
};
