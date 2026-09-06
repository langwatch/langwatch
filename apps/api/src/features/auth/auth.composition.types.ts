/**
 * ComposedAuthFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { AuthApp } from "@langwatch/auth-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createFrontDoorTrpcRouter, createPublicEnvTrpcProcedure } from "./auth-trpc.mount";

/** The two signed-out doors, and the application both answer from. */
export type ComposedAuthFeature = Readonly<{
  /** The composed auth application. */
  app: AuthApp;
  /**
   * ADR-027's single source of truth for this process, published so the
   * signed-in person's own account screens report the same mode the door they
   * came through offered.
   */
  resolveAuthProvider(): Promise<string>;
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    frontDoor: ReturnType<typeof createFrontDoorTrpcRouter>;
    publicEnv: ReturnType<typeof createPublicEnvTrpcProcedure>;
  }>;
}>;
