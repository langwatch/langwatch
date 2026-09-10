/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type {
  PayloadStaging,
  StoredObjectApp,
  StoredObjectStorageRuntimeAdapter,
  StoredObjectsService,
} from "@langwatch/stored-object-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createStoredObjectTrpcRouter } from "./stored-object-trpc.mount.ts";

/** The namespace, the `ctx.app` slice, and the byte store the doors take. */
export type ComposedStoredObjectFeature = Readonly<{
  /** `storedObjects.*`. Takes no ports: the probe reads the slice and nothing else. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createStoredObjectTrpcRouter>;
  /** For `ctx.app.storedObjectApp`, and for the byte door's row-and-stream reads. */
  app: StoredObjectApp;
  /** What `mountStoredObjectRest` resolves per request. */
  restServices: Readonly<{ storedObjects: () => StoredObjectApi }>;
  /**
   * The CONTENT-ADDRESSED store itself, published for the one caller that needs to write
   * bytes rather than read them: the scenario-event door, whose inline media the trace
   * vertical's extractor externalises.
   */
  bytes: StoredObjectsService;
  /**
   * Where an oversized outbound payload is parked while the call carrying it
   * is in flight. Published here because this feature owns the deployment's S3
   * access; the features that stage take it as a required collaborator.
   */
  payloadStaging: PayloadStaging;
  /**
   * The project-keyed byte storage, beside the AWS runtime its S3 driver
   * builds clients on. For a consumer that writes objects this feature owns no
   * row for: the ADR-022 trace spool.
   */
  storage: Readonly<{ runtime: StoredObjectStorageRuntimeAdapter; aws: AwsClientProcessRuntime }>;
  /** Released with the process: the pooled outbound handlers the S3 clients share. */
  close(): Promise<void>;
}>;
