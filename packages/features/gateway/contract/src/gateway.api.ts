import { featureApi } from "@langwatch/runtime-composition";
/** Callable gateway capability shared by API, worker, and task processes. */
export interface GatewayApi {
  assertOrganizationExists(organizationId: string): Promise<void>;
}

export const GatewayApi = featureApi<GatewayApi>("gateway");
