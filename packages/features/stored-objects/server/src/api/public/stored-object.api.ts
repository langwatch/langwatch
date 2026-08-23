import type { ServiceBuilder } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz";
import {
  createStoredObjectsPublicRpc,
  type StoredObjectDeliveryAudience,
  type StoredObjectsConfirmUploadInput,
  type StoredObjectsCreateUploadInput,
  type StoredObjectsDeleteInput,
  type StoredObjectsGetInput,
  type StoredObjectsService,
} from "@langwatch/stored-objects-contract";
import type { MiddlewareHandler } from "hono";

export const STORED_OBJECTS_PUBLIC_API_VERSION = "2026-08-22" as const;

export type StoredObjectsPublicApiEndpointMeta = Readonly<{
  permission: AuthzPermission;
}>;

export type StoredObjectsPublicApiOptions = Readonly<{
  service(
    context: unknown,
  ): StoredObjectsService | Promise<StoredObjectsService>;
  maximumUploadBytes: number;
  projectId(context: unknown): string;
  requirePermission(permission: AuthzPermission): MiddlewareHandler;
  authorizeAudience(input: {
    context: unknown;
    projectId: string;
    audience: StoredObjectDeliveryAudience;
  }): Promise<void>;
}>;

/** Thin public REST/RPC registration over the contract service capability. */
export class StoredObjectsPublicApi {
  static create(
    options: StoredObjectsPublicApiOptions,
  ): StoredObjectsPublicApi {
    return new StoredObjectsPublicApi(options);
  }

  private readonly noStore: MiddlewareHandler = async (context, next) => {
    await next();
    context.header("Cache-Control", "private, no-store");
  };

  private constructor(
    private readonly options: StoredObjectsPublicApiOptions,
  ) {}

  install<TProject, TVariables extends Record<string, unknown>>(
    api: ServiceBuilder<TProject, TVariables>,
  ): ServiceBuilder<TProject, TVariables> {
    const contract = createStoredObjectsPublicRpc(
      this.options.maximumUploadBytes,
    );
    const group = api.group("storedObjects", (builder) =>
      builder
        .withDocs({ tags: ["Stored Objects"] })
        .withRateLimit()
        .withMiddleware(this.noStore),
    );
    group.register(
      "createUpload",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsCreateUploadInput) =>
        (await this.options.service(context)).createUpload({
          ...input,
          projectId: this.options.projectId(context),
        }),
      (builder) =>
        builder
          .withInput(contract.createUpload.input)
          .withOutput(contract.createUpload.output)
          .withMiddleware(
            this.options.requirePermission(contract.createUpload.permission),
          )
          .withMeta({
            permission: contract.createUpload.permission,
          } satisfies StoredObjectsPublicApiEndpointMeta)
          .withDocs({
            operationId: "createStoredObjectUpload",
            summary: "Create a stored-object upload",
          }),
    );
    group.register(
      "confirmUpload",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsConfirmUploadInput) =>
        (await this.options.service(context)).confirmUpload({
          ...input,
          projectId: this.options.projectId(context),
        }),
      (builder) =>
        builder
          .withInput(contract.confirmUpload.input)
          .withOutput(contract.confirmUpload.output)
          .withMiddleware(
            this.options.requirePermission(contract.confirmUpload.permission),
          )
          .withMeta({
            permission: contract.confirmUpload.permission,
          } satisfies StoredObjectsPublicApiEndpointMeta)
          .withDocs({
            operationId: "confirmStoredObjectUpload",
            summary: "Confirm a stored-object upload",
          }),
    );
    group.register(
      "get",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsGetInput) => {
        const projectId = this.options.projectId(context);
        await this.options.authorizeAudience({
          context,
          projectId,
          audience: input.audience,
        });
        return (await this.options.service(context)).resolveDelivery({
          ...input,
          projectId,
        });
      },
      (builder) =>
        builder
          .withInput(contract.get.input)
          .withOutput(contract.get.output)
          .withMiddleware(
            this.options.requirePermission(contract.get.permission),
          )
          .withMeta({
            permission: contract.get.permission,
          } satisfies StoredObjectsPublicApiEndpointMeta)
          .withDocs({
            operationId: "getStoredObject",
            summary: "Resolve a fresh stored-object capability",
          }),
    );
    group.register(
      "delete",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsDeleteInput) =>
        (await this.options.service(context)).delete({
          ...input,
          projectId: this.options.projectId(context),
        }),
      (builder) =>
        builder
          .withInput(contract.delete.input)
          .withOutput(contract.delete.output)
          .withMiddleware(
            this.options.requirePermission(contract.delete.permission),
          )
          .withMeta({
            permission: contract.delete.permission,
          } satisfies StoredObjectsPublicApiEndpointMeta)
          .withDocs({
            operationId: "deleteStoredObject",
            summary: "Delete a stored object",
          }),
    );
    return api;
  }
}
