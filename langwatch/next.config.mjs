import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const bundleAnalyser = process.env.ANALYZE === "true"
  ? (await import("@next/bundle-analyzer")).default
  : null;
import fs from "fs";
import path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const aliasPath =
  process.env.DEPENDENCY_INJECTION_DIR ?? path.join("src", "injection");

const isProduction =
  process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev;
    style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev;
    img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://www.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev;
    font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${isProduction ? "upgrade-insecure-requests;" : ""}
    worker-src 'self' blob:;
    connect-src 'self' https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev;
    frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://www.googletagmanager.com https://www.google.com https://*.reo.dev;

`;

const existingNodeModules = new Set(
  fs.readdirSync(path.join(__dirname, "node_modules")),
);

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
    resolveAlias: {
      "@injected-dependencies.client": path.join(
        aliasPath,
        "injection.client.ts",
      ),
      "@injected-dependencies.server": path.join(
        aliasPath,
        "injection.server.ts",
      ),

      // read all folders from ./saas-src/node_modules and create a map like the above
      ...(fs.existsSync(path.join(__dirname, "saas-src", "node_modules"))
        ? Object.fromEntries(
            fs
              .readdirSync(path.join(__dirname, "saas-src", "node_modules"))
              .filter((key) => !existingNodeModules.has(key))
              .flatMap((key) => [
                [key, `./saas-src/node_modules/${key}`],
                [`${key}/*`, `./saas-src/node_modules/${key}/*`],
              ]),
          )
        : {}),
    },
  },

  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "pino-opentelemetry-transport",
    "thread-stream",
    "async_hooks",
    "geoip-country",
  ],

  experimental: {
    scrollRestoration: true,
    optimizePackageImports: [
      "@chakra-ui/react",
      "react-feather",
      "@zag-js",
      "@mui",
    ],
  },

  async headers() {
    // Only enable HSTS in production to avoid Safari caching issues in development
    const securityHeaders = [
      {
        key: "Referrer-Policy",
        value: "no-referrer",
      },
      {
        key: "Content-Security-Policy",
        value: cspHeader.replace(/\n/g, ""),
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      ...(isProduction
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
          ]
        : []),
    ];

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  webpack: (config) => {
    config.resolve.alias["@injected-dependencies.client"] = path.join(
      aliasPath,
      "injection.client.ts",
    );
    config.resolve.alias["@injected-dependencies.server"] = path.join(
      aliasPath,
      "injection.server.ts",
    );

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

    config.module.rules.push({
      test: /\.(js|jsx|ts|tsx)$/,
      use: [
        {
          loader: "string-replace-loader",
          options: {
            search: /@langwatch-oss\/node_modules\//g,
            replace: "",
            flags: "g",
          },
        },
        {
          loader: "string-replace-loader",
          options: {
            search: /@langwatch-oss\/src\//g,
            replace: "~/",
            flags: "g",
          },
        },
      ],
    });

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
