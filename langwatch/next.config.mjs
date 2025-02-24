import { withSentryConfig } from "@sentry/nextjs";
import path from "path";
import { fileURLToPath } from "url";

process.env.SENTRY_IGNORE_API_RESOLUTION_ERROR = "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://cdn.eu.pendo.io https://client.crisp.chat https://static.hsappstatic.net;
    style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.eu.pendo.io https://client.crisp.chat;
    img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://www.googletagmanager.com https://data.eu.pendo.io;
    font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
    connect-src 'self' https://data.eu.pendo.io wss://client.relay.crisp.chat;
    worker-src 'self' blob:;
    frame-src 'self' https://www.youtube.com https://get.langwatch.ai;
`;

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.mjs");

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,

  /**
   * If you are using `appDir` then you must comment the below `i18n` config out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },

  distDir: process.env.NEXTJS_DIST_DIR ?? ".next",

  experimental: {
    scrollRestoration: true,
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
    const aliasPath =
      process.env.DEPENDENCY_INJECTION_DIR ??
      path.join(__dirname, "src", "injection");

    config.resolve.alias["@injected-dependencies.client"] = path.join(
      aliasPath,
      "injection.client.ts"
    );
    config.resolve.alias["@injected-dependencies.server"] = path.join(
      aliasPath,
      "injection.server.ts"
    );

    if (process.env.EXTRA_INCLUDE) {
      // @ts-ignore
      const index = config.module.rules.findIndex((rule) =>
        rule.oneOf?.[0]?.include?.[0]?.includes("langwatch")
      );
      // TODO: find a less hacky way to make sure injected src will be compiled as well
      for (const rule of config.module.rules?.[index].oneOf ?? []) {
        const includeIsArray = Array.isArray(rule.include);
        if (includeIsArray) {
          rule.include.push(process.env.EXTRA_INCLUDE);
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default withSentryConfig(config, {
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
});
