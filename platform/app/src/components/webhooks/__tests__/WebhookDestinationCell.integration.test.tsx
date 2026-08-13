/**
 * @vitest-environment jsdom
 *
 * The list's destination column: what an operator reads to tell one
 * endpoint's transport from another's at a glance.
 */
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WebhookDestinationCell,
  type WebhookDestinationSummary,
} from "../WebhookDestinationCell";

function renderCells(endpoints: WebhookDestinationSummary[]) {
  render(
    <ChakraProvider value={defaultSystem}>
      <Table.Root>
        <Table.Body>
          {endpoints.map((endpoint) => (
            <Table.Row key={endpoint.id}>
              <WebhookDestinationCell endpoint={endpoint} />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("WebhookDestinationCell", () => {
  describe("given endpoints of both kinds", () => {
    /** @scenario The list says where each endpoint delivers */
    it("badges each row with its destination and shows the address that goes with it", () => {
      renderCells([
        {
          id: "wh_http",
          destinationKind: "http",
          url: "https://receiver.example.com/webhooks/langwatch",
          sqs: null,
        },
        {
          id: "wh_sqs",
          destinationKind: "sqs",
          url: null,
          sqs: {
            queueUrl:
              "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-billing",
          },
        },
      ]);

      expect(
        screen.getByTestId("webhook-destination-badge-wh_http"),
      ).toHaveTextContent("HTTPS endpoint");
      expect(
        screen.getByTestId("webhook-destination-address-wh_http"),
      ).toHaveTextContent("https://receiver.example.com/webhooks/langwatch");

      expect(
        screen.getByTestId("webhook-destination-badge-wh_sqs"),
      ).toHaveTextContent("Amazon SQS queue");
      // A queue row shows the queue rather than the blank a `url` read would
      // leave, since a queue endpoint has no URL at all.
      expect(
        screen.getByTestId("webhook-destination-address-wh_sqs"),
      ).toHaveTextContent(
        "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-billing",
      );
    });
  });
});
