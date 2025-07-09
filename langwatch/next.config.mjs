import { withSentryConfig } from "@sentry/nextjs";
import path from "path";
import fs from "fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bundleAnalyser from "@next/bundle-analyzer";

process.env.SENTRY_IGNORE_API_RESOLUTION_ERROR = "1";

const __dirname = dirname(fileURLToPath(import.meta.url));

const aliasPath =
  process.env.DEPENDENCY_INJECTION_DIR ?? path.join("src", "injection");

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com;
    style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat;
    img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://www.googletagmanager.com https://*.pendo.io https://*.google-analytics.com;
    font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
    connect-src 'self' https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com;
    worker-src 'self' blob:;
    frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://www.googletagmanager.com;
`;

const existingNodeModules = new Set(
  fs.readdirSync(path.join(__dirname, "node_modules"))
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

  experimental: {
    scrollRestoration: true,
    turbo: {
      resolveAlias: {
        "@injected-dependencies.client": path.join(
          aliasPath,
          "injection.client.ts"
        ),
        "@injected-dependencies.server": path.join(
          aliasPath,
          "injection.server.ts"
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
                ])
            )
          : {}),
      },
    },
    optimizePackageImports: [
      "@chakra-ui/react",
      "react-feather",
      "@zag-js",
      "@mui",
    ],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\n/g, ""),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },

  webpack: (config) => {
    config.resolve.alias["@injected-dependencies.client"] = path.join(
      aliasPath,
      "injection.client.ts"
    );
    config.resolve.alias["@injected-dependencies.server"] = path.join(
      aliasPath,
      "injection.server.ts"
    );

    // Ensures that only a single version of those are ever loaded
    // eslint-disable-next-line @typescript-eslint/dot-notation
    config.resolve.alias["react"] = `${__dirname}/node_modules/react`;
    config.resolve.alias["react-dom"] = `${__dirname}/node_modules/react-dom`;
    // eslint-disable-next-line @typescript-eslint/dot-notation
    config.resolve.alias["next"] = `${__dirname}/node_modules/next`;
    config.resolve.alias["next-auth"] = `${__dirname}/node_modules/next-auth`;
    // eslint-disable-next-line @typescript-eslint/dot-notation
    config.resolve.alias["zod"] = `${__dirname}/node_modules/zod`;

    // Add fallback for pino logger requirements
    config.resolve.fallback = {
      ...config.resolve.fallback,
      worker_threads: false,
      fs: false,
    };

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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default bundleAnalyser({ enabled: process.env.ANALYZE === "true" })(
  withSentryConfig(config, {
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options

    // Suppresses source map uploading logs during build
    silent: true,
    org: "langwatch",
    project: "langwatch",

    widenClientFileUpload: true,
    tunnelRoute: "/monitoring",
    sourcemaps: {
      disable: false,
      deleteSourcemapsAfterUpload: true,
    },
    disableLogger: true,
  })
);
