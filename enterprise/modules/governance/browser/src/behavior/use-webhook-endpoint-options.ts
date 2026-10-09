// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { webhookClient } from "@langwatch/webhook-client";
import { useMemo } from "react";

/** The organisation's webhook endpoints as picker options, labelled by where they deliver. */
export function useWebhookEndpointOptions({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const query = webhookClient.webhookEndpoints.list.useQuery(
    { organizationId },
    { enabled: enabled && !!organizationId, refetchOnWindowFocus: false },
  );
  const options = useMemo(
    () =>
      (query.data ?? []).map((endpoint) => ({
        value: endpoint.id,
        label: endpoint.url ?? endpoint.sqs?.queueUrl ?? endpoint.id,
      })),
    [query.data],
  );
  return { options, isLoading: query.isLoading };
}
