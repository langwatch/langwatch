/**
 * Publishes both `/api/secret` and `/api/secrets`; responses use strict,
 * value-free `secretPublicSchema`.
 */

// `projectId` stays on the wire where released clients put it, and the
// runtime's scope check compares it against the project the credential
// resolved. Every handler reads the CREDENTIAL's project, never the claim.

import type { Actor } from "@langwatch/actor";
import { AuthenticatedActorRequiredError, PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestRouter,
  type RestTransportDeclaration,
  UnauthorizedError,
} from "@langwatch/api/rest";
import {
  SecretApi,
  secretPublicCreateInputSchema,
  secretPublicDeleteInputSchema,
  secretPublicDeleteOutputSchema,
  secretPublicListInputSchema,
  secretPublicParamsSchema,
  secretPublicSchema,
  secretPublicUpdateInputSchema,
  toSecretPublic,
  type SecretCaller,
} from "@langwatch/secret-contract";

export const SECRET_REST_VERSION = "2026-08-24";

/** A secret is a name and a value; nothing legitimate arrives near this. */
const SECRET_MAX_INPUT_BYTES = 16 * 1024;

const secretBodyLimit = {
  maxBytes: SECRET_MAX_INPUT_BYTES,
  onExceeded: () => new PayloadTooLargeError(),
} as const;

/**
 * Who a write is attributed to. A credential bound to nobody cannot write: the
 * row carries `createdById`/`updatedById`, and a key is not a person.
 */
function callerOf(actor: Actor | null): SecretCaller {
  if (actor === null) throw new UnauthorizedError("Authentication required");
  if (actor.type === "user" || actor.type === "api_key") return { id: actor.id };

  throw new AuthenticatedActorRequiredError();
}

/** The five operation ids one namespace mount publishes, one per route. */
type SecretRestOperations = Readonly<{
  list: string;
  get: string;
  create: string;
  update: string;
  delete: string;
}>;

function defineSecretRest(
  namespace: string,
  operations: SecretRestOperations,
): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<SecretApi>;
}> {
  return defineRestRouter(SecretApi)
    .withNamespace(namespace)
    .withVersion(SECRET_REST_VERSION)

    .get("/", operations.list)
    .withQuery(secretPublicListInputSchema)
    .withPermission("secrets:view")
    .withOutput(secretPublicSchema.array())
    .withDocs({
      summary: "List project secrets",
      description:
        "Lists metadata only. Secret values are never returned. Requests have 16 KiB inputs; the service enforces the 50-secret cap. Responses are not cached.",
    })
    .handle(async ({ app, scope }) => {
      const secrets = await app.list({ projectId: scope.id });

      return secrets.map(toSecretPublic);
    })

    .get("/:secretId", operations.get)
    .withParams(secretPublicParamsSchema)
    .withQuery(secretPublicListInputSchema)
    .withPermission("secrets:view")
    .withOutput(secretPublicSchema)
    .withDocs({ summary: "Get project-secret metadata" })
    .handle(async ({ app, input, scope }) =>
      toSecretPublic(await app.get({ projectId: scope.id, id: input.secretId })),
    )

    .post("/", operations.create)
    .withInput(secretPublicCreateInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicSchema)
    .withStatus(201)
    .withDocs({
      summary: "Create a project secret",
      description: "Encrypts the value at rest and never returns it. Requests have 16 KiB inputs.",
    })
    .withBodyLimit(secretBodyLimit)
    .handle(async ({ app, input, scope, actor }) =>
      toSecretPublic(
        await app.create(
          { projectId: scope.id, name: input.name, value: input.value },
          callerOf(actor),
        ),
      ),
    )

    .put("/:secretId", operations.update)
    .withParams(secretPublicParamsSchema)
    .withInput(secretPublicUpdateInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicSchema)
    .withDocs({
      summary: "Replace a project secret value",
      description: "Requests have 16 KiB inputs.",
    })
    .withBodyLimit(secretBodyLimit)
    .handle(async ({ app, input, scope, actor }) =>
      toSecretPublic(
        await app.update(
          { projectId: scope.id, id: input.secretId, value: input.value },
          callerOf(actor),
        ),
      ),
    )

    .delete("/:secretId", operations.delete)
    .withParams(secretPublicParamsSchema)
    .withInput(secretPublicDeleteInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicDeleteOutputSchema)
    .withDocs({ summary: "Delete a project secret" })
    .withBodyLimit(secretBodyLimit)
    .handle(async ({ app, input, scope }) => {
      await app.delete({ projectId: scope.id, id: input.secretId });

      return { id: input.secretId, deleted: true as const };
    })
    .build();
}

export const secretRest = defineSecretRest("secret", {
  list: "listSecrets",
  get: "getSecret",
  create: "createSecret",
  update: "updateSecret",
  delete: "deleteSecret",
});
export const secretsAliasRest = defineSecretRest("secrets", {
  list: "getApiSecrets",
  get: "getApiSecretsById",
  create: "postApiSecrets",
  update: "putApiSecretsById",
  delete: "deleteApiSecretsById",
});
