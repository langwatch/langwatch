export default {
  resolve: {
    alias: {
      "@langwatch/coding-agent-contract/testing": new URL(
        "../contract/src/testing.ts",
        import.meta.url,
      ).pathname,
      "@langwatch/coding-agent-contract": new URL(
        "../contract/src/index.ts",
        import.meta.url,
      ).pathname,
      "@langwatch/github-contract": new URL(
        "../../github/contract/src/index.ts",
        import.meta.url,
      ).pathname,
      "@langwatch/project-contract": new URL(
        "../../project/contract/src/index.ts",
        import.meta.url,
      ).pathname,
      zod: new URL(
        "../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js",
        import.meta.url,
      ).pathname,
    },
  },
};
