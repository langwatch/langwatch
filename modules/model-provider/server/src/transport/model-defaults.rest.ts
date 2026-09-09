/**
 * `/api/model-defaults` — the default-model cascade for CLI and external API
 * callers, over the same application the tRPC surface uses. The application
 * gates each target scope against the KEY OWNER; the door adds the key's own
 * ceiling and `authorizeRequestedScopes`, which asks the CREDENTIAL too.
 */
import {
  baseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  ModelDefaultUserKeyRequiredError,
  ModelProviderApi,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import {
  apiResponseConfigCreatedSchema,
  apiResponseModelDefaultsSchema,
  createModelDefaultConfigInputSchema,
  updateModelDefaultConfigInputSchema,
} from "../rules/model-defaults-schemas.rules.ts";

const logger = createLogger("langwatch:api:model-defaults");

/** Ceiling on the project a key resolved to. Every scope a write NAMES is checked separately. */
const MODEL_DEFAULTS_WRITE_PERMISSION = "project:manage" as const;

const configIdParamsSchema = z.object({ id: z.string().min(1) });

// The operation ids are the ones the published document already carries. They
// read as machine-generated because they were: the older builder derived them
// from the method and the path. Renaming them renames an SDK method.

/**
 * The credential this request arrived on, as the process resolves one. Null
 * for a credential that names no key row — a legacy project key.
 */
export const modelDefaultsRestCredential = defineRestMiddleware(
  "modelDefaultsRestCredential",
  z
    .object({
      apiKeyId: z.string(),
      userId: z.string().nullable(),
      organizationId: z.string(),
    })
    .nullable(),
);

/** The roles the snapshot publishes, in the order it has always published them. */
const SNAPSHOT_ROLES = ["DEFAULT", "FAST", "EMBEDDINGS"] as const;

export const modelDefaultsRest = defineRestRouter(ModelProviderApi)
  .withNamespace("model-defaults")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "getApiModelDefaults")
  .withPermission("project:view")
  .withOutput(apiResponseModelDefaultsSchema)
  .withMiddleware(modelDefaultsRestCredential)
  .withDocs({
    description:
      "Snapshot of the default-model cascade for this project: effective resolution per role, plus the configs the caller can read.",
    responses: baseResponses,
  })
  .handle(async ({ app, scope }, credential) => {
    const owner = credential?.userId;
    // A key tied to nobody reads the cascade as nobody: the snapshot filters
    // what it shows by what its reader may see, and there is no reader here.
    const snapshot = owner
      ? await app.getDefaultSnapshot({ projectId: scope.id }, { id: owner })
      : await app.getDefaultSnapshotUnattributed({ projectId: scope.id });

    return {
      scope: {
        projectId: snapshot.projectId,
        teamId: snapshot.teamId,
        organizationId: snapshot.organizationId,
        organizationName: snapshot.organizationName,
      },
      effective: Object.fromEntries(
        SNAPSHOT_ROLES.map((role) => [role, snapshot.effective[role] ?? null]),
      ),
      configs: snapshot.configs.map((config) => ({
        id: config.id,
        config: config.config,
        scopes: config.scopes,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      })),
    };
  })

  .post("/", "postApiModelDefaults")
  .withInput(createModelDefaultConfigInputSchema)
  .withPermission(MODEL_DEFAULTS_WRITE_PERMISSION)
  .withOutput(apiResponseConfigCreatedSchema)
  .withMiddleware(modelDefaultsRestCredential)
  .withDocs({
    description:
      "Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST, LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.",
    responses: baseResponses,
  })
  .handle(async ({ app, input, scope }, credential) => {
    const author = requireKeyOwner(credential);

    await authorizeRequestedScopes({ app, credential, scopes: input.scopes });

    const saved = await app.saveDefaultConfig(
      { config: input.config, scopes: input.scopes },
      author,
    );

    logger.info(
      { projectId: scope.id, configId: saved.id, userId: author.id },
      "Created default-model config",
    );

    return { id: saved.id };
  })

  .put("/:id", "putApiModelDefaultsById")
  .withParams(configIdParamsSchema)
  .withInput(updateModelDefaultConfigInputSchema)
  .withPermission(MODEL_DEFAULTS_WRITE_PERMISSION)
  .withMiddleware(modelDefaultsRestCredential)
  .withDocs({
    description:
      "Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the config.",
    responses: { ...baseResponses, 204: { description: "Updated" } },
  })
  .handle(async ({ app, input, scope }, credential) => {
    const author = requireKeyOwner(credential);

    await authorizeRequestedScopes({ app, credential, scopes: input.scopes });

    await app.saveDefaultConfig(
      { id: input.id, config: input.config, scopes: input.scopes },
      author,
    );

    logger.info(
      { projectId: scope.id, configId: input.id, userId: author.id },
      "Updated default-model config",
    );
  })

  .delete("/:id", "deleteApiModelDefaultsById")
  .withParams(configIdParamsSchema)
  .withPermission(MODEL_DEFAULTS_WRITE_PERMISSION)
  .withMiddleware(modelDefaultsRestCredential)
  .withDocs({
    description: "Delete a default-model config. Scope attachments cascade.",
    responses: { ...baseResponses, 204: { description: "Deleted" } },
  })
  .handle(async ({ app, input, scope }, credential) => {
    const author = requireKeyOwner(credential);

    await app.deleteDefaultConfig({ id: input.id }, author);

    logger.info(
      { projectId: scope.id, configId: input.id, userId: author.id },
      "Deleted default-model config",
    );
  })
  .build();

/** The credential this door read, in the shape the scope check asks about. */
type ModelDefaultsCredential = z.infer<(typeof modelDefaultsRestCredential)["schema"]>;

/**
 * A default is set per person, so a key tied to nobody has no author to write
 * one as, and is told so rather than writing an unattributable config.
 */
function requireKeyOwner(credential: ModelDefaultsCredential): { id: string } {
  const userId = credential?.userId;

  if (!userId) throw new ModelDefaultUserKeyRequiredError();

  return { id: userId };
}

/**
 * The scopes a write NAMES, authorized against the credential rather than
 * against its owner. The application checks the same scopes against the key
 * owner; without this a project-restricted key minted by an administrator
 * wrote the organization's defaults with the administrator's grants.
 */
async function authorizeRequestedScopes({
  app,
  credential,
  scopes,
}: {
  app: Pick<ModelProviderApi, "assertApiKeyMayWriteDefaultScopes">;
  credential: ModelDefaultsCredential;
  scopes: ModelDefaultScope[] | undefined;
}): Promise<void> {
  if (!credential || !scopes?.length) return;

  await app.assertApiKeyMayWriteDefaultScopes({ apiKey: credential, scopes });
}
