import type { ServiceBuilder } from "@langwatch/api";
import {
  createStoredObjectsPublicRpc,
  type StoredObjectsConfirmUploadInput,
  type StoredObjectsCreateUploadInput,
  type StoredObjectsDeleteInput,
  type StoredObjectsGetInput,
  type StoredObjectService,
} from "@langwatch/stored-object-contract";
import type { MiddlewareHandler } from "hono";

export const STORED_OBJECTS_PUBLIC_API_VERSION = "2026-08-22" as const;

export type StoredObjectsPublicApiOptions = Readonly<{
  maximumUploadBytes: number;
}>;

export interface StoredObjectsPublicApp {
  readonly storedObjects: StoredObjectService;
}

/** Thin public REST/RPC registration over the contract service capability. */
export class StoredObjectsPublicApi {
  static create(options: StoredObjectsPublicApiOptions): StoredObjectsPublicApi {
    return new StoredObjectsPublicApi(options);
  }

  private readonly noStore: MiddlewareHandler = async (context, next) => {
    await next();
    context.header("Cache-Control", "private, no-store");
  };

  private constructor(private readonly options: StoredObjectsPublicApiOptions) {}

  install<TProject, TVariables extends Record<string, unknown>>(
    api: ServiceBuilder<TProject, TVariables, StoredObjectsPublicApp>,
  ): ServiceBuilder<TProject, TVariables, StoredObjectsPublicApp> {
    const contract = createStoredObjectsPublicRpc(this.options.maximumUploadBytes);
    const group = api.group("storedObjects", (builder) =>
      builder
        .withDocs({ tags: ["Stored Objects"] })
        .withRateLimit()
        .withMiddleware(this.noStore),
    );
    group.register(
      "createUpload",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsCreateUploadInput) => {
        return context.app.storedObjects.createUpload(input);
      },
      (builder) =>
        builder
          .withInput(contract.createUpload.input)
          .withOutput(contract.createUpload.output)
          .withPermission(contract.createUpload.permission)
          .withDocs({
            operationId: "createStoredObjectUpload",
            summary: "Create a stored-object upload",
          }),
    );
    group.register(
      "confirmUpload",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsConfirmUploadInput) => {
        return context.app.storedObjects.confirmUpload(input);
      },
      (builder) =>
        builder
          .withInput(contract.confirmUpload.input)
          .withOutput(contract.confirmUpload.output)
          .withPermission(contract.confirmUpload.permission)
          .withDocs({
            operationId: "confirmStoredObjectUpload",
            summary: "Confirm a stored-object upload",
          }),
    );
    group.register(
      "get",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsGetInput) => {
        await context.authorize(input.audience);
        return context.app.storedObjects.resolveDelivery(input);
      },
      (builder) =>
        builder
          .withInput(contract.get.input)
          .withOutput(contract.get.output)
          .withPermission(contract.get.permission)
          .withDocs({
            operationId: "getStoredObject",
            summary: "Resolve a fresh stored-object capability",
          }),
    );
    group.register(
      "delete",
      STORED_OBJECTS_PUBLIC_API_VERSION,
      async (context, input: StoredObjectsDeleteInput) => {
        return context.app.storedObjects.delete(input);
      },
      (builder) =>
        builder
          .withInput(contract.delete.input)
          .withOutput(contract.delete.output)
          .withPermission(contract.delete.permission)
          .withDocs({
            operationId: "deleteStoredObject",
            summary: "Delete a stored object",
          }),
    );
    return api;
  }
}
