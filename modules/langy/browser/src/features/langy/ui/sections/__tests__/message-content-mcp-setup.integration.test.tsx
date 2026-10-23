/**
 * @vitest-environment jsdom
 *
 * The `mcp_setup` tool call through the transcript: message-content draws the MCP setup card off
 * the call, with this deployment's address, and the activity spine leaves the call out.
 * @see specs/langy/langy-mcp-setup.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiDeployment: () => ({ isSaaS: false, appBaseUrl: "https://langwatch.acme.example" }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
    organization: { id: "org_1" },
  }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

import { LangyToolActivity } from "../langy-tool-activity.tsx";
import { MessageContent } from "../message-content.tsx";

// The sign-in method picker measures its indicator; jsdom has no ResizeObserver.
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function messageWith(input: Record<string, unknown>): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "Here is how to connect it." },
      {
        type: "tool-mcp_setup",
        toolCallId: "call-1",
        state: "output-available",
        input,
        output: "The MCP setup card is shown.",
      },
    ],
  };
}

function renderMessage(message: UIMessage) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <MessageContent
        message={message}
        organizationId="org_1"
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
      />
    </DesignSystemProvider>,
  );
}

describe("given an assistant message carrying an mcp_setup call", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the transcript draws it", () => {
    /** @scenario "The card shows this deployment's own MCP address" */
    it("shows the deployment's MCP URL with a copy button", () => {
      renderMessage(messageWith({}));

      expect(screen.getByTestId("langy-mcp-setup-url").textContent).toBe(
        "https://langwatch.acme.example/mcp",
      );
      expect(screen.getByRole("button", { name: "Copy the mcp server url" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Full guide/ })).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/integration/mcp",
      );
    });

    /** @scenario "OAuth is preselected and marked recommended" */
    it("preselects OAuth with the Recommended badge and says why", () => {
      renderMessage(messageWith({}));

      const card = screen.getByTestId("langy-mcp-setup-card");
      expect(within(card).getByText("Recommended")).toBeInTheDocument();
      expect(within(card).getByRole("radio", { name: /OAuth/ })).toBeChecked();
      expect(within(card).getByText(/tied to you and the project you approve/)).toBeInTheDocument();
    });

    /** @scenario "Claude Code gets a copyable command" */
    it("starts on the client Langy named and shows its command", () => {
      renderMessage(messageWith({ client: "claude-code" }));

      expect(screen.getByRole("button", { name: "Claude Code" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("langy-mcp-setup-steps").textContent).toContain(
        "claude mcp add --transport http langwatch https://langwatch.acme.example/mcp",
      );
    });
  });

  describe("when Langy named no client", () => {
    /** @scenario "A call without a client lets me pick it" */
    it("presses no client and asks the person to pick one before showing steps", () => {
      renderMessage(messageWith({}));

      const card = screen.getByTestId("langy-mcp-setup-card");
      expect(within(card).queryAllByRole("button", { pressed: true })).toEqual([]);
      expect(screen.queryByTestId("langy-mcp-setup-steps")).toBeNull();
      expect(screen.getByTestId("langy-mcp-setup-pick-client")).toBeInTheDocument();
    });
  });

  describe("when the person picks another client and the API key method", () => {
    /** @scenario "The API key method links to the API keys page and shows the header" */
    it("shows that client's key steps, the header and the API keys link", async () => {
      const user = userEvent.setup();
      renderMessage(messageWith({}));

      await user.click(screen.getByRole("button", { name: "Cursor" }));
      await user.click(screen.getByRole("radio", { name: "API key" }));

      expect(screen.getByTestId("langy-mcp-setup-header").textContent).toBe(
        "Authorization: Bearer YOUR_API_KEY",
      );
      expect(screen.getByRole("link", { name: "Settings, API Keys" })).toHaveAttribute(
        "href",
        "/settings/api-keys",
      );
      expect(screen.getByTestId("langy-mcp-setup-steps").textContent).toContain(
        "~/.cursor/mcp.json",
      );
    });
  });

  describe("when the activity spine draws it", () => {
    /** @scenario "The MCP setup call is a card, not an activity row" */
    it("leaves the call out, so the card is its only rendering", () => {
      const { container } = render(
        <DesignSystemProvider forcedTheme="light">
          <LangyToolActivity message={messageWith({})} />
        </DesignSystemProvider>,
      );

      expect(container.textContent).not.toContain("MCP setup");
      expect(container.textContent).not.toContain("mcp_setup");
    });
  });
});
