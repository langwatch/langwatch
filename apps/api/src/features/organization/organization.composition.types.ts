/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { OrganizationApi, OrganizationService } from "@langwatch/organization-contract";
import type {
  OrganizationProvisioning,
  OrganizationRestService,
} from "@langwatch/organization-server";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createOrganizationTrpcRouters } from "./organization-trpc.mount.ts";

/** The six namespaces, the `ctx.app.organizations` slice, and the two REST objects. */
export type ComposedOrganizationFeature = Readonly<{
  /** The `ctx.app.organizations` slice. */
  app: OrganizationApi;
  /**
   * The organization object the MANAGEMENT REST family serves from: the canonical
   * contract's settings reads and writes, plus the membership operations the contract
   * does not declare, routed onto one object.
   */
  rest: OrganizationRestService | undefined;
  /**
   * The same object again, in the shape `/api/organizations` takes.
   */
  provisioning: (OrganizationService & OrganizationProvisioning) | undefined;
  routers(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createOrganizationTrpcRouters<ApiTrpcContext>>;
}>;
