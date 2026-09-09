/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { OrganizationApi, OrganizationService } from "@langwatch/organization-contract";
import type {
  OrganizationProvisioningPort,
  OrganizationRestService,
} from "@langwatch/organization-server";

/** The slice and the two REST objects. The five tRPC namespaces are not here:
 * their transports are unconverted. */
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
  provisioning: (OrganizationService & OrganizationProvisioningPort) | undefined;
}>;
