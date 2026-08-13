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
  sqs: { queueUrl: string } | null;
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
  const address = endpoint.sqs?.queueUrl ?? endpoint.url ?? "";
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
          title={address}
          data-testid={`webhook-destination-address-${endpoint.id}`}
        >
          {address}
        </Text>
      </VStack>
    </Table.Cell>
  );
}
