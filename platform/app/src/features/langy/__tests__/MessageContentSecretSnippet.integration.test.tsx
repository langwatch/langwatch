/**
 * @vitest-environment jsdom
 *
 * The `secret_snippet` tool call through the transcript
 * (specs/langy/langy-secret-snippet.feature): MessageContent draws the card
 * off the call, and the activity spine leaves the call out, so the card is
 * the only rendering of it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
    organization: { id: "org_1" },
  }),
}));

vi.mock("../hooks/useLangyDevMode", () => ({
  useLangyDevMode: () => [false, vi.fn()],
}));

const revealOnce = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    secrets: {
      revealOnce: {
        useMutation: () => ({
          mutate: (
            input: unknown,
            options: { onSuccess: (r: { secret: string }) => void },
          ) => {
            revealOnce(input);
            options.onSuccess({ secret: "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW" });
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { LangyToolActivity } from "../components/LangyToolActivity";
import { MessageContent } from "../components/MessageContent";

const TEMPLATE =
  'export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="{{secret}}"';

function assistantMessage(): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Your key production-app is live. Point your app at the gateway with it:",
      },
      {
        type: "tool-secret_snippet",
        toolCallId: "call-1",
        state: "output-available",
        input: {
          revealId: "rvl_abc",
          template: TEMPLATE,
          preview: "vk-lw-01HZX9N",
        },
        output:
          "The secret snippet card is shown to the user, with the key filled in. Never print the key yourself.",
      },
    ],
  } as unknown as UIMessage;
}

describe("given an assistant message carrying a secret_snippet call", () => {
  afterEach(() => {
    cleanup();
    revealOnce.mockClear();
  });

  describe("when the transcript draws it", () => {
    /** @scenario "The card reveals the secret on first render, with a copy button" */
    it("draws the secret snippet card and reads the secret for the organization", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <MessageContent
            message={assistantMessage()}
            organizationId="org_1"
            appliedOutcomes={{}}
            discardedProposals={new Set()}
            applyingProposals={new Set()}
            onApply={async () => {}}
            onDiscard={() => {}}
          />
        </ChakraProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("langy-secret-snippet-card")).toHaveAttribute(
          "data-state",
          "shown",
        );
      });
      expect(revealOnce).toHaveBeenCalledWith({
        organizationId: "org_1",
        revealId: "rvl_abc",
      });
      expect(screen.getByTestId("langy-secret-snippet").textContent).toContain(
        'OPENAI_API_KEY="vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW"',
      );
    });
  });

  describe("when the activity spine draws it", () => {
    /** @scenario "The secret snippet call is a card, not an activity row" */
    it("leaves the call out, so the card is its only rendering", () => {
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={assistantMessage()} />
        </ChakraProvider>,
      );
      expect(container.textContent).not.toContain("Secret snippet");
      expect(container.textContent).not.toContain("secret_snippet");
      expect(
        container.querySelector("[data-testid='langy-secret-snippet-card']"),
      ).toBeNull();
    });
  });
});
