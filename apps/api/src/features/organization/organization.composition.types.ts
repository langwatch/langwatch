/**
 * ComposedOrganizationFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  OrganizationApp,
  OrganizationProvisioningPort,
  OrganizationRestService,
} from "@langwatch/organization-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
  createOnboardingTrpcRouter,
  createOrganizationTrpcRouter,
} from "./organization-trpc.mount";

/** The four namespaces this feature mounts, and the slice behind them. */
export type ComposedOrganizationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOrganizationTrpcRouter>;
  /** `group.*`, `joinRequests.*` and `onboarding.*`, over the membership half. */
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    group: ReturnType<typeof createGroupTrpcRouter>;
    joinRequests: ReturnType<typeof createJoinRequestTrpcRouter>;
    onboarding: ReturnType<typeof createOnboardingTrpcRouter>;
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
