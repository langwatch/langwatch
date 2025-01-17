import { withSentryConfig } from "@sentry/nextjs";
import path from "path";

process.env.SENTRY_IGNORE_API_RESOLUTION_ERROR = "1";

const aliasPath =
  process.env.DEPENDENCY_INJECTION_DIR ?? path.join("src", "injection");

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
      },
    },
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
  hideSourceMaps: true,
  disableLogger: true,
});
