/** The organization's private endpoints and the three binding changes, each refreshing the list. */
import { modelProviderApi } from "../../../behavior/model-provider-api.ts";

export function usePrivateEndpointBindings({ organizationId }: { organizationId: string }) {
  const utils = modelProviderApi.useUtils();
  const endpoints = modelProviderApi.privateModelEndpoint.listForOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );
  const refresh = () =>
    void utils.privateModelEndpoint.listForOrganization.invalidate({ organizationId });

  const bind = modelProviderApi.privateModelEndpoint.bind.useMutation({ onSuccess: refresh });
  const rebind = modelProviderApi.privateModelEndpoint.rebind.useMutation({ onSuccess: refresh });
  const unbind = modelProviderApi.privateModelEndpoint.unbind.useMutation({ onSuccess: refresh });

  return { endpoints, bind, rebind, unbind };
}
