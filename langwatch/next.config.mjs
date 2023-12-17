import { withSentryConfig } from "@sentry/nextjs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  webpack: (config) => {
    const aliasPath =
      process.env.DEPENDENCY_INJECTION ??
      path.join(__dirname, "src", "injection.ts");

    config.resolve.alias["@injected-dependencies"] = aliasPath;

    if (process.env.EXTRA_INCLUDE) {
      // TODO: find a less hacky way to make sure injected src will be compiled as well
      for (const rule of config.module.rules?.[1].oneOf ?? []) {
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

export default withSentryConfig(
  config,
  {
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options

    // Suppresses source map uploading logs during build
    silent: true,
    org: "langwatch",
    project: "langwatch",
  },
  {
    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Transpiles SDK to be compatible with IE11 (increases bundle size)
    transpileClientSDK: false,

    // Routes browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers (increases server load)
    tunnelRoute: "/monitoring",

    // Hides source maps from generated client bundles
    hideSourceMaps: true,

    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: true,
  }
);
