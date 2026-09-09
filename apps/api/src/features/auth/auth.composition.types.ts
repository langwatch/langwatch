/** Kept separate from the composition so importing the router type never pulls in the graph. */
import type { AuthApi } from "@langwatch/auth-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createFrontDoorTrpcRouter } from "./auth-trpc.mount.ts";

/** The signed-out door, and the application it answers from. */
export type ComposedAuthFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    frontDoor: ReturnType<typeof createFrontDoorTrpcRouter<ApiTrpcContext>>;
  };
  /** The installed auth application: browser sessions and the signed-out door. */
  app: AuthApi;
  /**
   * ADR-027's single source of truth for this process, published so the
   * signed-in person's own account screens report the same mode the door they
   * came through offered.
   */
  resolveAuthProvider(): Promise<string>;
}>;
