import fs from "node:fs";
import path from "node:path";

import {
  createPublicAppConfigMetaTag,
  processWebConfigSchema,
  publicAppConfigSchema,
  type ProcessWebConfig,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
import type { FeatureApiIdentity } from "@langwatch/module";
import { z } from "zod";

import { assetBaseBootstrapScript, assetBaseOrigin, normalizeAssetBase } from "./asset-base.ts";

export type ApiUiBundle = Readonly<{ directory: string; head: string; assetOrigin: string | null }>;
export type BundleConfig = Readonly<{
  directory: string;
  assetBase?: string;
  publicConfig: Readonly<Record<string, unknown>>;
}>;

/** An installed owner as the page's config reads it: its name and its declared projection. */
export type BrowserConfigOwner = Readonly<{
  name: string;
  apiContract?: FeatureApiIdentity;
  publicConfig?: (config: unknown, api: unknown) => unknown;
}>;

export function resolveUiBundle(config: BundleConfig): ApiUiBundle | undefined {
  const directory = path.resolve(config.directory);
  if (!fs.existsSync(path.join(directory, "index.html"))) return void 0;
  const assetBase = normalizeAssetBase(config.assetBase);
  return {
    directory,
    // Read per request: the page's config is filled once the modules exist.
    get head() {
      return (
        assetBaseBootstrapScript(assetBase) + createPublicAppConfigMetaTag(config.publicConfig)
      );
    },
    assetOrigin: assetBaseOrigin(assetBase),
  };
}

/**
 * The page's browser config (ARCHITECTURE.md §6): the process owner's slice,
 * then every installed module's declared projection under its own name. A
 * projection that refuses stops the boot, naming the module.
 */
export async function projectPublicConfig({
  modules,
  config,
  runningApi,
}: {
  modules: readonly BrowserConfigOwner[];
  config: Readonly<Record<string, unknown>>;
  runningApi: (contract: FeatureApiIdentity | undefined) => unknown;
}): Promise<PublicAppConfig> {
  const projected: Record<string, unknown> = {
    process: projectProcessConfig(config),
  };
  for (const module of modules) {
    if (!module.publicConfig) continue;
    if (module.name in projected) {
      throw new Error(`Two owners project browser config under "${module.name}".`);
    }
    try {
      projected[module.name] = await module.publicConfig(
        config[module.name],
        runningApi(module.apiContract),
      );
    } catch (cause) {
      throw new Error(`The browser config "${module.name}" projects was refused.`, { cause });
    }
  }
  return publicAppConfigSchema.parse(projected);
}

const processFacts = z.object({
  baseHost: z.string().optional(),
  nodeEnvironment: z.string().optional(),
  isSaas: z.boolean().optional(),
  nlpServiceUrl: z.string().optional(),
  hideDevIndicator: z.boolean().optional(),
  devIndicatorLabel: z.string().optional(),
});

/** An unrecognised NODE_ENV is production-shaped, as every default is (§6). */
const browserMode = processWebConfigSchema.shape.mode.catch("production");

function projectProcessConfig(config: Readonly<Record<string, unknown>>): ProcessWebConfig {
  const facts = processFacts.parse(config.process ?? {});
  return processWebConfigSchema.parse({
    ...(facts.baseHost ? { appBaseUrl: facts.baseHost } : {}),
    mode: browserMode.parse(facts.nodeEnvironment),
    deployment: facts.isSaas ? "saas" : "self-hosted",
    nlp: Boolean(facts.nlpServiceUrl),
    ...(facts.hideDevIndicator ? { hideDevIndicator: true } : {}),
    ...(facts.devIndicatorLabel ? { devIndicatorLabel: facts.devIndicatorLabel } : {}),
  });
}
