// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The organisation's AWS connections, read for a picker outside the kill switch. */
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
