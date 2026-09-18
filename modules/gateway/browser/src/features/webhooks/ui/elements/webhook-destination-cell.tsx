import { Badge, Table, Text, VStack } from "@chakra-ui/react";

import {
  WEBHOOK_DESTINATION_LABELS,
  type WebhookDestinationKind,
} from "../../model/webhook-destinations.ts";

/** Just enough of an endpoint to say where it delivers. */
export interface WebhookDestinationSummary {
  id: string;
  destinationKind: WebhookDestinationKind;
  url: string | null;
  sqs: { queueUrl: string; accountId: string; queueName: string } | null;
}

/**
 * What to print for a queue. Every SQS URL shares the same host, so the
 * clipped URL would look identical on every row and hide the account and
 * queue name — the only parts that say which queue it is. Full URL in title.
 */
function queueLabel(sqs: { queueUrl: string; accountId: string; queueName: string }): string {
  if (!sqs.accountId || !sqs.queueName) return sqs.queueUrl;
  return `${sqs.accountId}/${sqs.queueName}`;
}

/**
 * Where the endpoint delivers, in one cell: a badge naming the transport
 * and its address. Falls through to the queue rather than `url`, since a
 * queue endpoint has no URL and the column would otherwise sit blank.
 */
export function WebhookDestinationCell({ endpoint }: { endpoint: WebhookDestinationSummary }) {
  const address = endpoint.sqs ? queueLabel(endpoint.sqs) : (endpoint.url ?? "");
  const fullAddress = endpoint.sqs?.queueUrl ?? endpoint.url ?? "";
  return (
    <Table.Cell maxWidth="360px">
      <VStack align="start" gap={1}>
        <Badge
          size="sm"
          colorPalette={endpoint.destinationKind === "sqs" ? "purple" : "gray"}
          data-testid={`webhook-destination-badge-${endpoint.id}`}
        >
          {WEBHOOK_DESTINATION_LABELS[endpoint.destinationKind]}
        </Badge>
        <Text
          fontSize="sm"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          maxWidth="340px"
          title={fullAddress}
          data-testid={`webhook-destination-address-${endpoint.id}`}
        >
          {address}
        </Text>
      </VStack>
    </Table.Cell>
  );
}
