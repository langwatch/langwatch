/**
 * The project's secrets over REST, metadata only: every answer is
 * `secretPublicSchema`, `.strict()` with no value field. `/api/secret` and
 * `/api/secrets` are both published and a declaration carries one namespace,
 * so the family is stated twice; the plural suffixes its operation ids.
 */

// `projectId` stays on the wire where released clients put it, and the
// runtime's scope check compares it against the project the credential
// resolved. Every handler reads the CREDENTIAL's project, never the claim.

import { defineRestRouter, UnauthorizedError } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/actor";
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

/** Who a write is attributed to. A credential bound to nobody cannot write. */
function callerOf(actor: Actor | null): SecretCaller {
  if (actor && (actor.type === "user" || actor.type === "api_key")) return { id: actor.id };

  throw new UnauthorizedError("An authenticated actor is required");
}

function defineSecretRest(namespace: string, operationSuffix: string) {
  return defineRestRouter(SecretApi)
    .withNamespace(namespace)
    .withVersion(SECRET_REST_VERSION)

    .get("/", `listSecrets${operationSuffix}`)
    .withQuery(secretPublicListInputSchema)
    .withPermission("secrets:view")
    .withOutput(secretPublicSchema.array())
    .withDocs({
      summary: "List project secrets",
      description:
        "Lists metadata only. Secret values are never returned. The service enforces the 50-secret cap. Responses are not cached.",
    })
    .handle(async ({ app, scope }) => {
      const secrets = await app.list({ projectId: scope.id });

      return secrets.map(toSecretPublic);
    })

    .get("/:id", `getSecret${operationSuffix}`)
    .withParams(secretPublicParamsSchema)
    .withQuery(secretPublicListInputSchema)
    .withPermission("secrets:view")
    .withOutput(secretPublicSchema)
    .withDocs({ summary: "Get project-secret metadata" })
    .handle(async ({ app, input, scope }) =>
      toSecretPublic(await app.get({ projectId: scope.id, id: input.id })),
    )

    .post("/", `createSecret${operationSuffix}`)
    .withInput(secretPublicCreateInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicSchema)
    .withStatus(201)
    .withDocs({
      summary: "Create a project secret",
      description: "Encrypts the value at rest and never returns it.",
    })
    .handle(async ({ app, input, scope, actor }) =>
      toSecretPublic(
        await app.create(
          { projectId: scope.id, name: input.name, value: input.value },
          callerOf(actor),
        ),
      ),
    )

    .put("/:id", `updateSecret${operationSuffix}`)
    .withParams(secretPublicParamsSchema)
    .withInput(secretPublicUpdateInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicSchema)
    .withDocs({ summary: "Replace a project secret value" })
    .handle(async ({ app, input, scope, actor }) =>
      toSecretPublic(
        await app.update(
          { projectId: scope.id, id: input.id, value: input.value },
          callerOf(actor),
        ),
      ),
    )

    .delete("/:id", `deleteSecret${operationSuffix}`)
    .withParams(secretPublicParamsSchema)
    .withInput(secretPublicDeleteInputSchema)
    .withPermission("secrets:manage")
    .withOutput(secretPublicDeleteOutputSchema)
    .withDocs({ summary: "Delete a project secret" })
    .handle(async ({ app, input, scope }) => {
      await app.delete({ projectId: scope.id, id: input.id });

      return { id: input.id, deleted: true };
    })
    .build();
}

export const secretRest = defineSecretRest("secret", "");
export const secretsAliasRest = defineSecretRest("secrets", "PluralAlias");
