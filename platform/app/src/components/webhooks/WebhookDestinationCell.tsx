import { Badge, Table, Text, VStack } from "@chakra-ui/react";
import {
  WEBHOOK_DESTINATION_LABELS,
  type WebhookDestinationKind,
} from "~/utils/webhookDestinations";

/** Just enough of an endpoint to say where it delivers. */
export interface WebhookDestinationSummary {
  id: string;
  destinationKind: WebhookDestinationKind;
  url: string | null;
  sqs: { queueUrl: string; accountId: string; queueName: string } | null;
}

/**
 * What to print for a queue. Every Amazon SQS URL opens with the same
 * `https://sqs.<region>.amazonaws.com/`, and the cell clips the tail, so
 * printing the URL gives every row an identical visible string and hides the
 * account and the queue name, which are the only parts that say which queue
 * this is. The full URL stays in the title.
 */
function queueLabel(sqs: {
  queueUrl: string;
  accountId: string;
  queueName: string;
}): string {
  if (!sqs.accountId || !sqs.queueName) return sqs.queueUrl;
  return `${sqs.accountId}/${sqs.queueName}`;
}

/**
 * Where the endpoint delivers, in one cell: a badge naming the transport and
 * the address it uses.
 *
 * The address falls through to the queue rather than reading `url`, because a
 * queue endpoint has no URL and this column would otherwise be blank on one
 * of the two kinds.
 */
export function WebhookDestinationCell({
  endpoint,
}: {
  endpoint: WebhookDestinationSummary;
}) {
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
