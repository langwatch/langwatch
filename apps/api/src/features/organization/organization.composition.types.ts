/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  OrganizationApp,
  OrganizationProvisioningPort,
  OrganizationRestService,
} from "@langwatch/organization-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
  createOnboardingTrpcRouter,
  createOrganizationTrpcRouter,
  createTeamTrpcRouter,
} from "./organization-trpc.mount.ts";

/** The five namespaces this feature mounts, and the slice behind them. */
export type ComposedOrganizationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOrganizationTrpcRouter>;
  /**
   * `group.*`, `joinRequests.*`, `onboarding.*` and `team.*`, over the
   * membership half.
   */
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    group: ReturnType<typeof createGroupTrpcRouter>;
    joinRequests: ReturnType<typeof createJoinRequestTrpcRouter>;
    onboarding: ReturnType<typeof createOnboardingTrpcRouter>;
    team: ReturnType<typeof createTeamTrpcRouter>;
  }>;
  /** The `ctx.app.organizations` slice. */
  app: OrganizationApp;
  /**
   * The organization object the MANAGEMENT REST family serves from: the canonical
   * contract's settings reads and writes, plus the membership operations the contract
   * does not declare, routed onto one object.
   */
  rest: OrganizationRestService | undefined;
  /**
   * The same object again, in the shape `/api/organizations` takes.
   */
  provisioning: (OrganizationService & OrganizationProvisioningPort) | undefined;
}>;
