/**
 * API-key's config slice: only what a docs session key's origin check needs (ADR-185). Every
 * leaf is a shared deployment fact, so this module and the API host read the same answer.
 */
import {
  Config,
  docsOrigins,
  isSaas,
  publicBaseUrl,
  registeredDocsOrigins,
  type ConfigOf,
} from "@langwatch/config";
import {
  defineBrowserConfig,
  parsePublicConfigSlice,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const apiKeyServerConfig = Config.define(() => ({
  /** `LANGWATCH_DOCS_ORIGINS`: the documentation sites a docs session key may be handed to. */
  docsOrigins,
  /** A hosted deployment registers LangWatch Cloud's documentation site when it names none. */
  isSaas,
  /** This deployment's own origin, where haven and a same-host install serve the docs. */
  publicBaseUrl,
}));

export type ApiKeyServerConfig = ConfigOf<typeof apiKeyServerConfig>;

/** Every origin the consent page may hand a docs session to, this deployment's own included. */
export function docsOriginsOf(config: ApiKeyServerConfig | undefined): readonly string[] {
  return registeredDocsOrigins({
    configured: config?.docsOrigins,
    isSaas: config?.isSaas ?? false,
    publicBaseUrl: config?.publicBaseUrl,
  });
}

/** All the browser learns: which sites the consent page may answer. Origins, never secrets. */
const apiKeyWebConfigSchemaDefinition = z.strictObject({ docsOrigins: z.array(z.string()) });
export interface ApiKeyWebConfigSchema extends Named<typeof apiKeyWebConfigSchemaDefinition> {}
export const apiKeyWebConfigSchema: ApiKeyWebConfigSchema = apiKeyWebConfigSchemaDefinition;

export const apiKeyBrowserConfig = defineBrowserConfig({
  schema: apiKeyWebConfigSchema,
  project: (config: ApiKeyServerConfig) => ({ docsOrigins: [...docsOriginsOf(config)] }),
});

/** The registered docs origins as the page's config carries them; none when it carries none. */
export function publicDocsOrigins(config: PublicAppConfig): readonly string[] {
  try {
    return parsePublicConfigSlice({ config, owner: "api-key", schema: apiKeyWebConfigSchema })
      .docsOrigins;
  } catch {
    return [];
  }
}
