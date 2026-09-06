/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
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
