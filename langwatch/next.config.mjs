import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "path";

const bundleAnalyser =
  process.env.ANALYZE === "true"
    ? (await import("@next/bundle-analyzer")).default
    : null;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.mjs");

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  logging: false,
  distDir: process.env.NEXTJS_DIST_DIR ?? ".next",

  typescript: {
    // Typechecking here is slow, and is now handled by a dedicated CI job using tsgo!
    ignoreBuildErrors: true,
  },

  turbopack: {
    rules: {
      "*.snippet.sts": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.go": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.sh": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.py": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.yaml": { loaders: ["raw-loader"], as: "*.js" },
    },
  },

  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "pino-opentelemetry-transport",
    "thread-stream",
    "async_hooks",
    "geoip-country",
    "@aws-sdk/client-lambda",
    "@aws-sdk/client-cloudwatch-logs",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-ses",
    "@aws-sdk/client-sts",
    "tiktoken",
    "bcrypt",
  ],

  experimental: {
    reactCompiler: true,
    scrollRestoration: true,
    optimizePackageImports: [
      "@chakra-ui/react",
      "react-feather",
      "@zag-js",
      "@mui",
    ],
  },

  // Security headers are handled by src/middleware.ts at runtime
  // so that DISABLE_HTTPS_HEADERS env var works with pre-built Docker images.

  webpack: (config) => {
    // Ensures that only a single version of those are ever loaded
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys below
    config.resolve.alias["react"] = `${__dirname}/node_modules/react`;
    config.resolve.alias["react-dom"] = `${__dirname}/node_modules/react-dom`;
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys
    config.resolve.alias["next"] = `${__dirname}/node_modules/next`;
    config.resolve.alias["next-auth"] = `${__dirname}/node_modules/next-auth`;
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys
    config.resolve.alias["zod"] = `${__dirname}/node_modules/zod`;

    // Add fallback for pino logger requirements (browser-side)
    if (!config.isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "pino-pretty": false,
        fs: false,
        stream: false,
        "node:stream": false,
        worker_threads: false,
        "node:worker_threads": false,
        async_hooks: false,
        "node:async_hooks": false,
      };
    }

    // Support importing files with `?snippet` to get source content for IDE-highlighted snippets
    config.module.rules.push({
      resourceQuery: /snippet/,
      type: "asset/source",
    });

    // Treat any *.snippet.* files as source assets to avoid resolution inside snippets
    config.module.rules.push({
      test: /\.snippet\.(txt|sts|ts|tsx|js|go|sh|py|yaml)$/i,
      type: "asset/source",
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default bundleAnalyser
  ? bundleAnalyser({ enabled: true })(config)
  : config;
