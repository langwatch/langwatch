/**
 * @vitest-environment jsdom
 *
 * RTL coverage for the webhook endpoint drawer: registry-driven checkbox
 * grouping, the family wildcard locking its children, the not-yet-emitting
 * label, and the save payload; plus the secret dialog's shown-once framing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebhookEndpointDrawer } from "../WebhookEndpointDrawer";
import { WebhookSecretDialog } from "../WebhookSecretDialog";

const EVENT_TYPES = [
  {
    type: "gateway.request.completed",
    family: "gateway",
    schemaVersion: "1" as const,
    isEmitting: true,
    description: "The billing feed.",
  },
  {
    type: "gateway.budget.breached",
    family: "gateway",
    schemaVersion: "1" as const,
    isEmitting: false,
    description: "A budget reached its cap.",
  },
];

type DrawerEndpoint = NonNullable<
  Parameters<typeof WebhookEndpointDrawer>[0]["endpoint"]
>;

/** A saved queue endpoint, with only the queue half worth varying. */
function sqsEndpoint(
  sqs: Partial<NonNullable<DrawerEndpoint["sqs"]>> = {},
): DrawerEndpoint {
  return {
    id: "wh_1",
    organizationId: "org_1",
    destinationKind: "sqs",
    url: null,
    sqs: {
      queueUrl: "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test",
      region: "eu-central-1",
      accountId: "381491922238",
      queueName: "lw-test",
      credentialMode: "assume_role",
      roleArn: "arn:aws:iam::381491922238:role/langwatch-webhook-producer",
      externalId: "lw-abc",
      accessKeyId: null,
      ...sqs,
    },
    enabledEvents: ["gateway.request.completed"],
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 100,
    maxBatchDelayMs: 250,
    maxInFlight: 4,
  } as DrawerEndpoint;
}

function renderDrawer(props: Partial<Parameters<typeof WebhookEndpointDrawer>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <WebhookEndpointDrawer
        isOpen
        endpoint={null}
        eventTypes={EVENT_TYPES}
        isSaving={false}
        onClose={vi.fn()}
        onSave={onSave}
        {...props}
      />
    </ChakraProvider>,
  );
  return { onSave };
}

afterEach(() => cleanup());

describe("WebhookEndpointDrawer", () => {
  /** @scenario Event checkboxes render grouped by family from the registry */
  it("groups event checkboxes by family with the wildcard header", () => {
    renderDrawer();
    expect(screen.getByTestId("webhook-family-gateway")).toBeInTheDocument();
    expect(screen.getByText("All Gateway events")).toBeInTheDocument();
    expect(screen.getByText("gateway.request.completed")).toBeInTheDocument();
    expect(screen.getByText("gateway.budget.breached")).toBeInTheDocument();
  });

  /** @scenario Types without a producer yet are labeled in the drawer */
  it("labels types whose producer has not landed yet", () => {
    renderDrawer();
    expect(screen.getByText("not emitting yet")).toBeInTheDocument();
  });

  /** @scenario The family wildcard locks its children and saves as the wildcard selector */
  it("locks individual types while the family wildcard is on and saves the wildcard", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDrawer();

    await user.type(screen.getByTestId("webhook-url-input"), "https://example.com/hook");
    await user.click(screen.getByTestId("webhook-family-toggle-gateway"));

    const exact = screen.getByTestId("webhook-event-gateway.request.completed");
    expect(exact.closest("label")).toHaveAttribute("data-disabled");

    await user.click(screen.getByTestId("webhook-save"));
    expect(onSave).toHaveBeenCalledWith({
      destinationKind: "http",
      url: "https://example.com/hook",
      enabledEvents: ["gateway.*"],
      maxBatchSize: 100,
      maxBatchDelayMs: 250,
      maxInFlight: 4,
    });
  });

  it("saves exact selections when no wildcard is on", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDrawer();

    await user.type(screen.getByTestId("webhook-url-input"), "https://example.com/hook");
    await user.click(screen.getByTestId("webhook-event-gateway.request.completed"));
    await user.click(screen.getByTestId("webhook-save"));
    expect(onSave).toHaveBeenCalledWith({
      destinationKind: "http",
      url: "https://example.com/hook",
      enabledEvents: ["gateway.request.completed"],
      maxBatchSize: 100,
      maxBatchDelayMs: 250,
      maxInFlight: 4,
    });
  });

  /** @scenario Saving requires a URL and at least one selected event */
  it("cannot save without a URL and at least one event", () => {
    renderDrawer();
    expect(screen.getByTestId("webhook-save")).toBeDisabled();
  });
});

describe("WebhookSecretDialog", () => {
  /** @scenario Delivery controls are editable in the drawer within their bounds */
  it("renders the delivery controls with defaults and saves edited values", async () => {
    const { onSave } = renderDrawer();
    const user = userEvent.setup();

    const batchSize = screen.getByTestId("webhook-max-batch-size");
    const batchDelay = screen.getByTestId("webhook-max-batch-delay");
    const inFlight = screen.getByTestId("webhook-max-in-flight");
    expect(batchSize).toHaveValue(100);
    expect(batchDelay).toHaveValue(250);
    expect(inFlight).toHaveValue(4);

    await user.type(screen.getByTestId("webhook-url-input"), "https://example.com/hooks");
    await user.click(screen.getByTestId("webhook-event-gateway.request.completed"));
    await user.clear(batchSize);
    await user.type(batchSize, "25");
    await user.clear(batchDelay);
    await user.type(batchDelay, "1000");
    await user.clear(inFlight);
    await user.type(inFlight, "2");
    await user.click(screen.getByTestId("webhook-save"));

    expect(onSave).toHaveBeenCalledWith({
      destinationKind: "http",
      url: "https://example.com/hooks",
      enabledEvents: ["gateway.request.completed"],
      maxBatchSize: 25,
      maxBatchDelayMs: 1000,
      maxInFlight: 2,
    });
  });

  /** @scenario The signing secret dialog warns it is shown only once */
  it("shows the secret with the shown-once warning while open", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <WebhookSecretDialog secret="whsec_test123" onClose={vi.fn()} />
      </ChakraProvider>,
    );
    expect(screen.getByTestId("webhook-secret-value")).toHaveTextContent("whsec_test123");
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  describe("when choosing where the endpoint delivers", () => {
    /** @scenario The destination kind is a choice, and each kind asks for its own fields */
    it("offers both destinations and swaps the address field with the choice", async () => {
      const user = userEvent.setup();
      renderDrawer();

      expect(screen.getByText("HTTPS endpoint")).toBeInTheDocument();
      expect(screen.getByText("Amazon SQS queue")).toBeInTheDocument();
      // HTTPS is the default, so the URL field is the one on screen.
      expect(screen.getByTestId("webhook-url-input")).toBeInTheDocument();
      expect(screen.queryByTestId("webhook-sqs-queue-url")).not.toBeInTheDocument();

      await user.click(screen.getByText("Amazon SQS queue"));

      expect(screen.getByTestId("webhook-sqs-queue-url")).toBeInTheDocument();
      expect(screen.queryByTestId("webhook-url-input")).not.toBeInTheDocument();
    });

    /** @scenario A queue endpoint saves only once its queue URL is filled in */
    it("keeps save disabled until the queue URL is entered, then sends the queue", async () => {
      const user = userEvent.setup();
      const { onSave } = renderDrawer();

      await user.click(screen.getByText("Amazon SQS queue"));
      await user.click(screen.getByTestId("webhook-event-gateway.request.completed"));
      expect(screen.getByTestId("webhook-save")).toBeDisabled();

      await user.type(
        screen.getByTestId("webhook-sqs-queue-url"),
        "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test",
      );
      // The queue URL alone is the whole requirement. Typing a role first
      // would let a regression that makes role assumption mandatory pass.
      expect(screen.getByTestId("webhook-save")).toBeEnabled();

      await user.type(
        screen.getByTestId("webhook-sqs-role-arn"),
        "arn:aws:iam::381491922238:role/langwatch-webhook-producer",
      );
      expect(screen.getByTestId("webhook-save")).toBeEnabled();

      await user.click(screen.getByTestId("webhook-save"));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationKind: "sqs",
          sqs: {
            queueUrl: "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test",
            roleArn: "arn:aws:iam::381491922238:role/langwatch-webhook-producer",
          },
        }),
      );
    });

    /** @scenario A saved role destination shows the external id to trust */
    it("shows the generated external id when editing, and never on a new endpoint", async () => {
      const user = userEvent.setup();
      // A role is worthless until its trust policy names this id, and the
      // server is the only place it exists, so an edit that cannot read it
      // back leaves the recommended credential mode impossible to finish.
      renderDrawer({ endpoint: sqsEndpoint({ externalId: "lw-abc123" }) });

      expect(screen.getByTestId("webhook-sqs-external-id")).toHaveTextContent(
        "lw-abc123",
      );

      cleanup();
      renderDrawer();
      await user.click(screen.getByText("Amazon SQS queue"));
      expect(screen.queryByTestId("webhook-sqs-external-id")).not.toBeInTheDocument();
    });

    /** @scenario A saved role destination shows the external id to trust */
    it("shows no external id block for a queue reached with an access key pair", () => {
      renderDrawer({
        endpoint: sqsEndpoint({
          externalId: null,
          roleArn: null,
          credentialMode: "static",
          accessKeyId: "AKIAEXAMPLE",
        }),
      });

      expect(screen.queryByTestId("webhook-sqs-external-id")).not.toBeInTheDocument();
    });

    /** @scenario An existing endpoint cannot be moved to another destination kind */
    it("locks the choice once the endpoint exists", () => {
      renderDrawer({
        endpoint: {
          id: "wh_1",
          organizationId: "org_1",
          destinationKind: "sqs",
          url: null,
          sqs: {
            queueUrl: "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test",
            region: "eu-central-1",
            accountId: "381491922238",
            queueName: "lw-test",
            credentialMode: "assume_role",
            roleArn: "arn:aws:iam::381491922238:role/langwatch-webhook-producer",
            externalId: "lw-abc",
            accessKeyId: null,
          },
          enabledEvents: ["gateway.request.completed"],
          status: "ACTIVE",
          disabledReason: null,
          disabledAt: null,
          failingSince: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          maxBatchSize: 100,
          maxBatchDelayMs: 250,
          maxInFlight: 4,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const control = screen.getByTestId("webhook-destination-kind");
      const options = [...control.querySelectorAll("input")];
      // Assert the options exist before asserting anything about them: a
      // for-of over an empty list passes while proving nothing.
      expect(options).toHaveLength(2);
      // Every option is unavailable, which is what says "not here" rather
      // than letting a click silently do nothing.
      for (const input of options) {
        expect(input).toBeDisabled();
      }
      // The queue it already has is the field on screen, prefilled.
      expect(screen.getByTestId("webhook-sqs-queue-url")).toHaveValue(
        "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test",
      );
      // The stored secret is never prefilled: an empty box means keep it.
      expect(screen.getByTestId("webhook-sqs-secret-access-key")).toHaveValue("");
    });
  });
});
