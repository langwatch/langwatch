// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The organisation's AWS connections, read for a picker, and the refresh after one is added. */
import { api } from "../../../behavior/governance-api.ts";

export function useAwsConnections({ organizationId }: { organizationId: string }) {
  const connections = api.governanceKillSwitch.awsConnections.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  return {
    connections: connections.data ?? [],
    isLoading: !organizationId || connections.isPending,
    error: connections.error,
    retry: () => void connections.refetch(),
  };
}

export function useAwsConnectionsRefresh({ organizationId }: { organizationId: string }) {
  const utils = api.useUtils();
  return {
    afterConnectionChange: async () => {
      await utils.governanceKillSwitch.awsConnections.invalidate({ organizationId });
    },
  };
}
