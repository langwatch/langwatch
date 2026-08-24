import type {
  EndpointVariables,
  ServiceBuilder,
} from "@langwatch/api";
import {
  secretPublicRpc,
  toSecretPublic,
  type SecretPublicCreateInput,
  type SecretPublicDeleteInput,
  type SecretPublicGetInput,
  type SecretPublicListInput,
  type SecretPublicUpdateInput,
  type SecretService,
} from "@langwatch/secret-contract";

export const SECRET_PUBLIC_API_VERSION = "2026-08-24" as const;

type SecretApplication = Readonly<{ secrets: SecretService }>;

export class SecretPublicApi {
  private constructor() {}

  static create(): SecretPublicApi {
    return new SecretPublicApi();
  }

  install<TProject>(
    api: ServiceBuilder<TProject, EndpointVariables, SecretApplication>,
  ): ServiceBuilder<TProject, EndpointVariables, SecretApplication> {
    const group = api.group("secrets", (builder) =>
      builder.withDocs({ tags: ["Secrets"] }),
    );
    group.register(
      "list",
      SECRET_PUBLIC_API_VERSION,
      async (context, input: SecretPublicListInput) => {
        const service = context.app.secrets;
        return (await service.list({ projectId: input.projectId })).map(
          toSecretPublic,
        );
      },
      (builder) =>
        builder
          .withInput(secretPublicRpc.list.input)
          .withOutput(secretPublicRpc.list.output)
          .withPermission(secretPublicRpc.list.permission)
          .withDocs({
            operationId: "listSecrets",
            summary: "List project secrets",
            description: "Lists metadata only. Secret values are never returned.",
          }),
    );
    group.register(
      "get",
      SECRET_PUBLIC_API_VERSION,
      async (context, input: SecretPublicGetInput) => {
        const service = context.app.secrets;
        return toSecretPublic(
          await service.get({
            projectId: input.projectId,
            id: input.id,
          }),
        );
      },
      (builder) =>
        builder
          .withInput(secretPublicRpc.get.input)
          .withOutput(secretPublicRpc.get.output)
          .withPermission(secretPublicRpc.get.permission)
          .withDocs({
            operationId: "getSecret",
            summary: "Get project-secret metadata",
          }),
    );
    group.register(
      "create",
      SECRET_PUBLIC_API_VERSION,
      async (context, input: SecretPublicCreateInput) => {
        const service = context.app.secrets;
        return toSecretPublic(
          await service.create({
            ...input,
            actorId: context.actor().id,
          }),
        );
      },
      (builder) =>
        builder
          .withInput(secretPublicRpc.create.input)
          .withOutput(secretPublicRpc.create.output)
          .withPermission(secretPublicRpc.create.permission)
          .withDocs({
            operationId: "createSecret",
            summary: "Create a project secret",
            description: "Encrypts the value at rest and never returns it.",
          }),
    );
    group.register(
      "update",
      SECRET_PUBLIC_API_VERSION,
      async (context, input: SecretPublicUpdateInput) => {
        const service = context.app.secrets;
        return toSecretPublic(
          await service.update({
            ...input,
            actorId: context.actor().id,
          }),
        );
      },
      (builder) =>
        builder
          .withInput(secretPublicRpc.update.input)
          .withOutput(secretPublicRpc.update.output)
          .withPermission(secretPublicRpc.update.permission)
          .withDocs({
            operationId: "updateSecret",
            summary: "Replace a project secret value",
          }),
    );
    group.register(
      "delete",
      SECRET_PUBLIC_API_VERSION,
      async (context, input: SecretPublicDeleteInput) => {
        const service = context.app.secrets;
        await service.delete({
          projectId: input.projectId,
          id: input.id,
        });
        return { id: input.id, deleted: true as const };
      },
      (builder) =>
        builder
          .withInput(secretPublicRpc.delete.input)
          .withOutput(secretPublicRpc.delete.output)
          .withPermission(secretPublicRpc.delete.permission)
          .withDocs({
            operationId: "deleteSecret",
            summary: "Delete a project secret",
          }),
    );
    return api;
  }
}
