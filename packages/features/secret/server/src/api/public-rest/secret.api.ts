import type { RestService } from "@langwatch/api/rest";
import { secretPublicRest, toSecretPublic, type SecretService } from "@langwatch/secret-contract";

export const SECRET_PUBLIC_API_VERSION = "2026-08-24" as const;

type SecretApplication = Readonly<{ secrets: SecretService }>;
type SecretPublicRestService<TApplication extends SecretApplication> = RestService<
  TApplication,
  false,
  true,
  true
>;
type SecretPublicRestApiOptions = Readonly<{ operationIdSuffix?: string }>;

export class SecretPublicRestApi {
  private constructor() {}

  static create(): SecretPublicRestApi {
    return new SecretPublicRestApi();
  }

  install<TApplication extends SecretApplication>(
    api: SecretPublicRestService<TApplication>,
    options: SecretPublicRestApiOptions = {},
  ): SecretPublicRestService<TApplication> {
    const operationIdSuffix = options.operationIdSuffix ?? "";
    api
      .get("/", SECRET_PUBLIC_API_VERSION, (endpoint) =>
        endpoint
          .withInput(secretPublicRest.list.input)
          .withOutput(secretPublicRest.list.output)
          .withPermission(secretPublicRest.list.permission)
          .withDocs({
            operationId: `listSecrets${operationIdSuffix}`,
            summary: "List project secrets",
            description:
              "Lists metadata only. Secret values are never returned. Requests have 16 KiB inputs; the service enforces the 50-secret cap. Responses are not cached.",
            tags: ["Secrets"],
          })
          .handle(async (context, input) =>
            (await context.app.secrets.list({ projectId: input.projectId })).map(toSecretPublic),
          ),
      )
      .get("/:id", SECRET_PUBLIC_API_VERSION, (endpoint) =>
        endpoint
          .withInput(secretPublicRest.get.input)
          .withOutput(secretPublicRest.get.output)
          .withPermission(secretPublicRest.get.permission)
          .withDocs({
            operationId: `getSecret${operationIdSuffix}`,
            summary: "Get project-secret metadata",
            tags: ["Secrets"],
          })
          .handle(async (context, input) =>
            toSecretPublic(
              await context.app.secrets.get({ projectId: input.projectId, id: input.id }),
            ),
          ),
      )
      .post("/", SECRET_PUBLIC_API_VERSION, (endpoint) =>
        endpoint
          .withInput(secretPublicRest.create.input)
          .withOutput(secretPublicRest.create.output)
          .withPermission(secretPublicRest.create.permission)
          .withStatus(201)
          .withDocs({
            operationId: `createSecret${operationIdSuffix}`,
            summary: "Create a project secret",
            description: "Encrypts the value at rest and never returns it.",
            tags: ["Secrets"],
          })
          .handle(async (context, input) =>
            toSecretPublic(
              await context.app.secrets.create({ ...input, actorId: context.actor().id }),
            ),
          ),
      )
      .put("/:id", SECRET_PUBLIC_API_VERSION, (endpoint) =>
        endpoint
          .withInput(secretPublicRest.update.input)
          .withOutput(secretPublicRest.update.output)
          .withPermission(secretPublicRest.update.permission)
          .withDocs({
            operationId: `updateSecret${operationIdSuffix}`,
            summary: "Replace a project secret value",
            tags: ["Secrets"],
          })
          .handle(async (context, input) =>
            toSecretPublic(
              await context.app.secrets.update({ ...input, actorId: context.actor().id }),
            ),
          ),
      )
      .delete("/:id", SECRET_PUBLIC_API_VERSION, (endpoint) =>
        endpoint
          .withInput(secretPublicRest.delete.input)
          .withOutput(secretPublicRest.delete.output)
          .withPermission(secretPublicRest.delete.permission)
          .withDocs({
            operationId: `deleteSecret${operationIdSuffix}`,
            summary: "Delete a project secret",
            tags: ["Secrets"],
          })
          .handle(async (context, input) => {
            await context.app.secrets.delete({ projectId: input.projectId, id: input.id });
            return { id: input.id, deleted: true };
          }),
      );
    return api;
  }
}
