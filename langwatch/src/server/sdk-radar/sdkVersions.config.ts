export interface SdkVersionInfo {
  displayName: string;
  latestVersion: string;
  releasesUrl: string;
  docsUrl: string;
  releaseTagPrefix: string;
  installCommands: Record<string, string>;
}

/**
 * Registry of known LangWatch SDKs and their latest versions.
 * Keyed by `sdkName` → `sdkLanguage` → info.
 *
 * `latestVersion` is the hardcoded fallback — dynamic versions are fetched
 * from GitHub releases and cached in Redis (see latestSdkVersions.ts).
 *
 * Versions come from sdk-versions.json, updated automatically by release-please.
 */
export const SDK_REGISTRY: Record<string, Record<string, SdkVersionInfo>> = {
  "langwatch-observability-sdk": {
    python: {
      displayName: "Python",
      latestVersion: "0.13.0",
      releasesUrl:
        "https://github.com/langwatch/langwatch/releases?q=python-sdk",
      docsUrl: "https://docs.langwatch.ai/integration/python/guide",
      releaseTagPrefix: "python-sdk@v",
      installCommands: {
        pip: "pip install langwatch --upgrade",
        uv: "uv add langwatch",
      },
    },
    typescript: {
      displayName: "TypeScript",
      latestVersion: "0.16.1",
      releasesUrl:
        "https://github.com/langwatch/langwatch/releases?q=typescript-sdk",
      docsUrl: "https://docs.langwatch.ai/integration/typescript/guide",
      releaseTagPrefix: "typescript-sdk@v",
      installCommands: {
        npm: "npm install langwatch@latest",
        pnpm: "pnpm add langwatch@latest",
      },
    },
  },
  "langwatch-client-sdk": {
    typescript: {
      displayName: "TypeScript",
      latestVersion: "0.16.1",
      releasesUrl:
        "https://github.com/langwatch/langwatch/releases?q=typescript-sdk",
      docsUrl: "https://docs.langwatch.ai/integration/typescript/guide",
      releaseTagPrefix: "typescript-sdk@v",
      installCommands: {
        npm: "npm install langwatch@latest",
        pnpm: "pnpm add langwatch@latest",
      },
    },
  },
};
