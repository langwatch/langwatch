export default {
  resolve: {
    alias: {
      zod: new URL(
        "../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js",
        import.meta.url,
      ).pathname,
    },
  },
};
