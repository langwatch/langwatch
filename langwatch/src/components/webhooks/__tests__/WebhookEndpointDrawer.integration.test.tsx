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
    emitting: true,
    description: "The billing feed.",
  },
  {
    type: "gateway.budget.breached",
    family: "gateway",
    schemaVersion: "1" as const,
    emitting: false,
    description: "A budget reached its cap.",
  },
];

function renderDrawer(
  props: Partial<Parameters<typeof WebhookEndpointDrawer>[0]> = {},
) {
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

    await user.type(
      screen.getByTestId("webhook-url-input"),
      "https://example.com/hook",
    );
    await user.click(screen.getByTestId("webhook-family-toggle-gateway"));

    const exact = screen.getByTestId("webhook-event-gateway.request.completed");
    expect(exact.closest("label")).toHaveAttribute("data-disabled");

    await user.click(screen.getByTestId("webhook-save"));
    expect(onSave).toHaveBeenCalledWith({
      url: "https://example.com/hook",
      enabledEvents: ["gateway.*"],
    });
  });

  it("saves exact selections when no wildcard is on", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDrawer();

    await user.type(
      screen.getByTestId("webhook-url-input"),
      "https://example.com/hook",
    );
    await user.click(
      screen.getByTestId("webhook-event-gateway.request.completed"),
    );
    await user.click(screen.getByTestId("webhook-save"));
    expect(onSave).toHaveBeenCalledWith({
      url: "https://example.com/hook",
      enabledEvents: ["gateway.request.completed"],
    });
  });

  /** @scenario Saving requires a URL and at least one selected event */
  it("cannot save without a URL and at least one event", () => {
    renderDrawer();
    expect(screen.getByTestId("webhook-save")).toBeDisabled();
  });
});

describe("WebhookSecretDialog", () => {
  /** @scenario The signing secret dialog warns it is shown only once */
  it("shows the secret with the shown-once warning while open", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <WebhookSecretDialog secret="whsec_test123" onClose={vi.fn()} />
      </ChakraProvider>,
    );
    expect(screen.getByTestId("webhook-secret-value")).toHaveTextContent(
      "whsec_test123",
    );
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });
});
