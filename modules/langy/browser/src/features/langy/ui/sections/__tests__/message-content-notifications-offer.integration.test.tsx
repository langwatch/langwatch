/**
 * @vitest-environment jsdom
 *
 * The `offer_notifications` call through the transcript: the offer comes before long work, so
 * its card sits at the call and the work streams in below it, not after the closing reply.
 * @see specs/langy/langy-notifications.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
    organization: { id: "org_1" },
  }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({ user: { getNotificationPreference: { setData: vi.fn() } } }),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    notification: {
      subscribeWebPush: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      unsubscribeWebPush: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    user: {
      getNotificationPreference: {
        useQuery: () => ({ data: { topic: "langy", choice: "enabled" }, isLoading: false }),
      },
      setNotificationPreference: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

import { LANGY_NOTIFICATIONS_ENABLED_LINE } from "../langy-notifications-offer-card.tsx";
import { MessageContent } from "../message-content.tsx";

const CLOSING_REPLY = "All ready! Tracing, a first scenario and a suite are set up.";

const assistantMessage: UIMessage = {
  id: "assistant-1",
  role: "assistant",
  parts: [
    { type: "text", text: "Connected. Setting up tracing now." },
    {
      type: "tool-offer_notifications",
      toolCallId: "call-offer",
      state: "output-available",
      input: {},
      output: "The notifications card is shown.",
    },
    {
      type: "tool-local_bash",
      toolCallId: "call-bash",
      state: "output-available",
      input: { command: "pip install langwatch" },
      output: "Successfully installed langwatch",
    },
    { type: "text", text: CLOSING_REPLY },
  ],
};

describe("given a turn that offered notifications and then kept working", () => {
  afterEach(() => {
    vi.stubGlobal("Notification", undefined);
    cleanup();
  });

  describe("when the transcript draws it", () => {
    /** @scenario "The offer stays where Langy made it while the work goes on below it" */
    it("draws the offer card before the reply that closes the turn", () => {
      vi.stubGlobal(
        "Notification",
        class {
          static permission = "granted";
          static requestPermission = vi.fn();
        },
      );
      render(
        <DesignSystemProvider forcedTheme="light">
          <MessageContent
            message={assistantMessage}
            organizationId="org_1"
            appliedOutcomes={{}}
            discardedProposals={new Set()}
            applyingProposals={new Set()}
            onApply={async () => {}}
            onDiscard={() => {}}
          />
        </DesignSystemProvider>,
      );

      const card = screen.getByText(LANGY_NOTIFICATIONS_ENABLED_LINE);
      const reply = screen.getByText(CLOSING_REPLY);
      expect(card.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
