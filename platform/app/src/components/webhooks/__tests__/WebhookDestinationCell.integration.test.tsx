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
            accountId: "381491922238",
            queueName: "lw-billing",
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
        screen.getByTestId("webhook-destination-address-wh_sqs").textContent,
      ).toBe("381491922238/lw-billing");
    });
  });

  describe("given two queues that differ only past the shared URL prefix", () => {
    /** @scenario The list tells one queue from another */
    it("prints the account and the queue name, and keeps the URL in the title", () => {
      renderCells([
        {
          id: "wh_a",
          destinationKind: "sqs",
          url: null,
          sqs: {
            queueUrl:
              "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-billing",
            accountId: "381491922238",
            queueName: "lw-billing",
          },
        },
        {
          id: "wh_b",
          destinationKind: "sqs",
          url: null,
          sqs: {
            queueUrl:
              "https://sqs.eu-central-1.amazonaws.com/999988887777/lw-billing-eu",
            accountId: "999988887777",
            queueName: "lw-billing-eu",
          },
        },
      ]);

      // The cell clips the tail, and every queue URL opens with the same
      // `https://sqs.<region>.amazonaws.com/`, so printing the URL made both
      // rows read the same and hid the only parts that differ.
      const first = screen.getByTestId("webhook-destination-address-wh_a");
      const second = screen.getByTestId("webhook-destination-address-wh_b");
      // Exact equality, not `toHaveTextContent`: that matches a substring, and
      // the full URL contains the account and queue name, so it would pass on
      // the very rendering this test exists to rule out.
      expect(first.textContent).toBe("381491922238/lw-billing");
      expect(second.textContent).toBe("999988887777/lw-billing-eu");

      expect(first).toHaveAttribute(
        "title",
        "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-billing",
      );
    });
  });

  describe("given a stored queue URL the parser could not split", () => {
    /** @scenario The list tells one queue from another */
    it("falls back to the whole URL rather than printing a bare slash", () => {
      renderCells([
        {
          id: "wh_odd",
          destinationKind: "sqs",
          url: null,
          sqs: {
            queueUrl: "https://sqs.eu-central-1.amazonaws.com/queue",
            accountId: "",
            queueName: "",
          },
        },
      ]);

      expect(
        screen.getByTestId("webhook-destination-address-wh_odd"),
      ).toHaveTextContent("https://sqs.eu-central-1.amazonaws.com/queue");
    });
  });
});
