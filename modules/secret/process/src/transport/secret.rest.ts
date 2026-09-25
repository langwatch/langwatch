/**
 * Publishes both `/api/secret` and `/api/secrets`; responses use strict,
 * value-free `secretPublicSchema`.
 */

// `projectId` stays on the wire where released clients put it, and the
// runtime's scope check compares it against the project the credential
// resolved. Every handler reads the CREDENTIAL's project, never the claim.

import type { Actor } from "@langwatch/actor";
import { AuthenticatedActorRequiredError, PayloadTooLargeError } from "@langwatch/api";
import { defineRestRouter, UnauthorizedError } from "@langwatch/api/rest";
import {
  SecretApi,
  secretPublicCreateInputSchema,
  secretPublicDeleteInputSchema,
  secretPublicDeleteOutputSchema,
  secretPublicAliasParamsSchema,
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

const LIST_DOCS = {
  summary: "List project secrets",
  description:
    "Lists metadata only. Secret values are never returned. Requests have 16 KiB inputs; the service enforces the 50-secret cap. Responses are not cached.",
};

const GET_DOCS = { summary: "Get project-secret metadata" };

const CREATE_DOCS = {
  summary: "Create a project secret",
  description: "Encrypts the value at rest and never returns it. Requests have 16 KiB inputs.",
};

const UPDATE_DOCS = {
  summary: "Replace a project secret value",
  description: "Requests have 16 KiB inputs.",
};

const DELETE_DOCS = { summary: "Delete a project secret" };

/** The branch's own family, addressing a secret as `:secretId`. */
export const secretRest = defineRestRouter(SecretApi)
  .withNamespace("secret")
  .withVersion(SECRET_REST_VERSION)

  .get("/", "listSecrets")
  .withQuery(secretPublicListInputSchema)
  .withPermission("secrets:view")
  .withOutput(secretPublicSchema.array())
  .withDocs(LIST_DOCS)
  .handle(async ({ app, scope }) => (await app.list({ projectId: scope.id })).map(toSecretPublic))

  .get("/:secretId", "getSecret")
  .withParams(secretPublicParamsSchema)
  .withQuery(secretPublicListInputSchema)
  .withPermission("secrets:view")
  .withOutput(secretPublicSchema)
  .withDocs(GET_DOCS)
  .handle(async ({ app, input, scope }) =>
    toSecretPublic(await app.get({ projectId: scope.id, id: input.secretId })),
  )

  .post("/", "createSecret")
  .withInput(secretPublicCreateInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicSchema)
  .withStatus(201)
  .withDocs(CREATE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope, actor }) =>
    toSecretPublic(
      await app.create(
        { projectId: scope.id, name: input.name, value: input.value },
        callerOf(actor),
      ),
    ),
  )

  .put("/:secretId", "updateSecret")
  .withParams(secretPublicParamsSchema)
  .withInput(secretPublicUpdateInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicSchema)
  .withDocs(UPDATE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope, actor }) =>
    toSecretPublic(
      await app.update(
        { projectId: scope.id, id: input.secretId, value: input.value },
        callerOf(actor),
      ),
    ),
  )

  .delete("/:secretId", "deleteSecret")
  .withParams(secretPublicParamsSchema)
  .withInput(secretPublicDeleteInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicDeleteOutputSchema)
  .withDocs(DELETE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope }) => {
    await app.delete({ projectId: scope.id, id: input.secretId });

    return { id: input.secretId, deleted: true as const };
  })
  .build();

/** The family main published, addressing a secret as `{id}` as main did. */
export const secretsAliasRest = defineRestRouter(SecretApi)
  .withNamespace("secrets")
  .withVersion(SECRET_REST_VERSION)

  .get("/", "getApiSecrets")
  .withQuery(secretPublicListInputSchema)
  .withPermission("secrets:view")
  .withOutput(secretPublicSchema.array())
  .withDocs(LIST_DOCS)
  .handle(async ({ app, scope }) => (await app.list({ projectId: scope.id })).map(toSecretPublic))

  .get("/:id", "getApiSecretsById")
  .withParams(secretPublicAliasParamsSchema)
  .withQuery(secretPublicListInputSchema)
  .withPermission("secrets:view")
  .withOutput(secretPublicSchema)
  .withDocs(GET_DOCS)
  .handle(async ({ app, input, scope }) =>
    toSecretPublic(await app.get({ projectId: scope.id, id: input.id })),
  )

  .post("/", "postApiSecrets")
  .withInput(secretPublicCreateInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicSchema)
  .withStatus(201)
  .withDocs(CREATE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope, actor }) =>
    toSecretPublic(
      await app.create(
        { projectId: scope.id, name: input.name, value: input.value },
        callerOf(actor),
      ),
    ),
  )

  .put("/:id", "putApiSecretsById")
  .withParams(secretPublicAliasParamsSchema)
  .withInput(secretPublicUpdateInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicSchema)
  .withDocs(UPDATE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope, actor }) =>
    toSecretPublic(
      await app.update({ projectId: scope.id, id: input.id, value: input.value }, callerOf(actor)),
    ),
  )

  .delete("/:id", "deleteApiSecretsById")
  .withParams(secretPublicAliasParamsSchema)
  .withInput(secretPublicDeleteInputSchema)
  .withPermission("secrets:manage")
  .withOutput(secretPublicDeleteOutputSchema)
  .withDocs(DELETE_DOCS)
  .withBodyLimit(secretBodyLimit)
  .handle(async ({ app, input, scope }) => {
    await app.delete({ projectId: scope.id, id: input.id });

    return { id: input.id, deleted: true as const };
  })
  .build();
