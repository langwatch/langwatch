/**
 * @vitest-environment jsdom
 *
 * Binds langy-baseline.feature scenarios:
 *   - "Propose creating an evaluator without applying it" (UI part)
 *   - "Apply a proposed evaluator"
 *   - "Discard a proposal"
 *   - "Destructive proposals are visually distinct"
 */
import { vi } from "vitest";

// jsdom does not provide the web stream globals that `ai` /
// `eventsource-parser` require at import time. Polyfill via
// vi.hoisted so it runs before the component imports below.
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const streamWeb = require("node:stream/web") as {
    TransformStream: unknown;
    ReadableStream: unknown;
    WritableStream: unknown;
  };
  if (typeof (globalThis as { TransformStream?: unknown }).TransformStream === "undefined") {
    Object.assign(globalThis, {
      TransformStream: streamWeb.TransformStream,
      ReadableStream:
        (globalThis as { ReadableStream?: unknown }).ReadableStream ??
        streamWeb.ReadableStream,
      WritableStream:
        (globalThis as { WritableStream?: unknown }).WritableStream ??
        streamWeb.WritableStream,
    });
  }
});

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Avoid pulling the streaming SSE parser via @ai-sdk/react (needs
// TransformStream which jsdom does not polyfill). ProposalCard itself
// never touches useChat — only the LangyPanel does.
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
  }),
}));

import {
  ProposalCard,
  type LangyProposal,
} from "~/components/langy/LangySidebar";

function renderCard(props: Partial<Parameters<typeof ProposalCard>[0]> = {}) {
  const defaults: Parameters<typeof ProposalCard>[0] = {
    proposal: {
      langyProposal: true,
      kind: "create_evaluator",
      summary: "Add a Hallucination evaluator",
      rationale: "You have 3 failing rows in this experiment.",
      payload: {},
    },
    appliedOutcome: undefined,
    isDiscarded: false,
    isApplying: false,
    onApply: vi.fn(),
    onDiscard: vi.fn(),
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProposalCard {...defaults} {...props} />
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("ProposalCard", () => {
  describe("given a fresh (non-destructive) proposal", () => {
    describe("when the card is rendered", () => {
      it("displays the proposal summary", () => {
        renderCard();
        expect(
          screen.getByText("Add a Hallucination evaluator"),
        ).toBeDefined();
      });

      it("renders an Apply button", () => {
        renderCard();
        const apply = screen.getByRole("button", { name: /^Apply$/i });
        expect(apply).toBeDefined();
      });

      it("renders a Discard button", () => {
        renderCard();
        const discard = screen.getByRole("button", { name: /^Discard$/i });
        expect(discard).toBeDefined();
      });

      it("labels the card with the proposal affordance overline", () => {
        renderCard();
        expect(screen.getByText(/^Proposal$/i)).toBeDefined();
      });
    });

    describe("when the user clicks Apply", () => {
      it("invokes the onApply callback exactly once", async () => {
        const onApply = vi.fn();
        renderCard({ onApply });
        await userEvent.click(
          screen.getByRole("button", { name: /^Apply$/i }),
        );
        expect(onApply).toHaveBeenCalledTimes(1);
      });

      it("does not invoke the onDiscard callback", async () => {
        const onApply = vi.fn();
        const onDiscard = vi.fn();
        renderCard({ onApply, onDiscard });
        await userEvent.click(
          screen.getByRole("button", { name: /^Apply$/i }),
        );
        expect(onDiscard).not.toHaveBeenCalled();
      });
    });

    describe("when the user clicks Discard", () => {
      it("invokes the onDiscard callback exactly once", async () => {
        const onDiscard = vi.fn();
        renderCard({ onDiscard });
        await userEvent.click(
          screen.getByRole("button", { name: /^Discard$/i }),
        );
        expect(onDiscard).toHaveBeenCalledTimes(1);
      });

      it("does not invoke onApply", async () => {
        const onApply = vi.fn();
        const onDiscard = vi.fn();
        renderCard({ onApply, onDiscard });
        await userEvent.click(
          screen.getByRole("button", { name: /^Discard$/i }),
        );
        expect(onApply).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a proposal currently being applied", () => {
    describe("when isApplying is true", () => {
      it("disables every action button so the proposal cannot be re-clicked mid-flight", () => {
        const { container } = renderCard({ isApplying: true });
        const buttons = container.querySelectorAll("button");
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
          expect((btn as HTMLButtonElement).disabled).toBe(true);
        }
      });
    });
  });

  describe("given a proposal that has been applied", () => {
    const appliedProps = {
      appliedOutcome: { href: "/demo/evaluators/hallucination-v1" } as const,
    };

    describe("when the card renders with an appliedOutcome", () => {
      it("transitions to the Applied state label", () => {
        renderCard(appliedProps);
        expect(screen.getByText(/Applied/i)).toBeDefined();
      });

      it("hides the Apply button", () => {
        renderCard(appliedProps);
        expect(
          screen.queryByRole("button", { name: /^Apply$/i }),
        ).toBeNull();
      });

      it("hides the Discard button", () => {
        renderCard(appliedProps);
        expect(
          screen.queryByRole("button", { name: /^Discard$/i }),
        ).toBeNull();
      });

      it("renders an Open affordance pointing at the new resource", () => {
        renderCard(appliedProps);
        const open = screen.getByRole("link", { name: /Open/i });
        expect(open.getAttribute("href")).toBe(
          "/demo/evaluators/hallucination-v1",
        );
      });
    });
  });

  describe("given a destructive proposal", () => {
    const destructiveProposal: LangyProposal = {
      langyProposal: true,
      kind: "delete_evaluator",
      summary: "Archive the Toxicity evaluator",
      payload: {},
      destructive: true,
    };

    describe("when the card renders", () => {
      it("uses the destructive 'Delete' button label instead of 'Apply'", () => {
        renderCard({ proposal: destructiveProposal });
        expect(
          screen.getByRole("button", { name: /^Delete$/i }),
        ).toBeDefined();
        expect(
          screen.queryByRole("button", { name: /^Apply$/i }),
        ).toBeNull();
      });

      it("uses the 'Cancel' affordance instead of 'Discard'", () => {
        renderCard({ proposal: destructiveProposal });
        expect(
          screen.getByRole("button", { name: /^Cancel$/i }),
        ).toBeDefined();
      });

      it("surfaces the 'Wants to delete' status label", () => {
        renderCard({ proposal: destructiveProposal });
        expect(screen.getByText(/Wants to delete/i)).toBeDefined();
      });
    });

    describe("when the destructive proposal completes", () => {
      it("transitions to a 'Done' status (not 'Applied') so the action verb stays explicit", () => {
        renderCard({
          proposal: destructiveProposal,
          appliedOutcome: {},
        });
        expect(screen.getByText(/^Done$/i)).toBeDefined();
      });
    });
  });
});
