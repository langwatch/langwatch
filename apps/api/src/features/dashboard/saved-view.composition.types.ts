/**
 * ComposedSavedViewFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createSavedViewTrpcRouter } from "./dashboard-trpc.mount";

/** The one namespace, built over this process's own connection. */
export type ComposedSavedViewFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createSavedViewTrpcRouter>;
}>;
