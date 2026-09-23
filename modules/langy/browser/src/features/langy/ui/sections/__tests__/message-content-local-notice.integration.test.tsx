/**
 * @vitest-environment jsdom
 *
 * A shared-folder disconnect writes a `system`-role NOTICE (ADR-129): the panel must keep it
 * (the engine drops every other role) and draw it as a plain line, not as a reader message.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
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

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import type * as rechartsModule from "recharts";

import { isLangyTranscriptMessage } from "../../../../../model/langy-transcript.ts";
import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const NOTICE_TEXT = "Local folder disconnected: acme-app on rogerio-mbp";

function message({ role }: { role: "system" | "user" }): UIMessage {
  return {
    id: `m-${role}`,
    role,
    parts: [{ type: "text", text: NOTICE_TEXT }],
  } as unknown as UIMessage;
}

function renderMessage(uiMessage: UIMessage) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={uiMessage}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
      />
    </ChakraProvider>,
  );
}

describe("given a transcript that carries the disconnect notice", () => {
  describe("when the panel draws the conversation", () => {
    /** @scenario "The disconnect notice reads as a notice, not as something I sent" */
    it("draws the notice as a plain line, not as a message from me", () => {
      renderMessage(message({ role: "system" }));

      expect(screen.getByTestId("langy-transcript-notice")).toHaveTextContent(NOTICE_TEXT);
    });

    it("keeps the notice in the transcript the engine hydrates", () => {
      expect(isLangyTranscriptMessage({ role: "system" })).toBe(true);
      expect(isLangyTranscriptMessage({ role: "user" })).toBe(true);
      expect(isLangyTranscriptMessage({ role: "assistant" })).toBe(true);
      expect(isLangyTranscriptMessage({ role: "tool" })).toBe(false);
    });
  });

  describe("when the same words are something the developer sent", () => {
    it("draws them as a message from me", () => {
      renderMessage(message({ role: "user" }));

      expect(screen.queryByTestId("langy-transcript-notice")).toBeNull();
      expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
    });
  });
});
