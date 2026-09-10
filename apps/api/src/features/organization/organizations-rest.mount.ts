/**
 * Binds the `organizations` REST declaration (`@langwatch/organization-server`)
 * to this process's instance-administrator door: provisioning, self-hosted
 * only. Minting the bootstrap admin key is the application's own
 * orchestration now, over its `apiKeys` peer.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { organizationsProvisioningRest } from "@langwatch/organization-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export type OrganizationsProvisioningRestOptions = Readonly<{ organizations: () => OrganizationApi }>;

/** Mounts `/api/organizations` behind this process's instance admin credential. */
export function mountOrganizationsRest(
  runtime: ApiRestRuntime,
  options: OrganizationsProvisioningRestOptions,
): MountableRestApp {
  return runtime.mount(organizationsProvisioningRest.router(), options.organizations, {});
}
