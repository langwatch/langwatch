/**
 * @vitest-environment jsdom
 * The secret snippet card: shown once with a copy, masked on every later render. Boundary mock:
 * the one mutation the card calls; the server's answers are the fixtures.
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revealOnce = vi.fn();
let answer: () => Promise<{ secret: string; preview: string }> = async () => {
  throw new Error("no answer set");
};

/** Stable across renders, as react-query's `mutate` is, so a retry must re-arm the read itself. */
function mutate(
  input: unknown,
  options: {
    onSuccess: (r: { secret: string; preview: string }) => void;
    onError: (e: unknown) => void;
  },
) {
  revealOnce(input);
  void answer().then(options.onSuccess, options.onError);
}

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    secrets: {
      revealOnce: { useMutation: () => ({ mutate, isPending: false }) },
    },
  },
}));

import { useLangySecretRevealStore } from "../../../../../behavior/langy-secret-reveal.store.ts";
import type { LangySecretSnippetCall } from "../../../../../model/langy-secret-snippet-tool.ts";
import {
  LANGY_SECRET_GONE_LINE,
  LANGY_SECRET_SHOWN_ONCE_LINE,
  LangySecretSnippetCard,
} from "../../../../../ui/sections/derived-cards/langy-secret-snippet-card.tsx";

const SECRET = "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW";
const TEMPLATE =
  'export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="{{secret}}"';
const CALL = {
  callId: "c1",
  revealId: "rvl_abc",
  template: TEMPLATE,
  preview: "vk-lw-01HZX9N",
};

/** The refusal as tRPC delivers it to the client. */
function refusal(code: string) {
  return {
    message: code,
    data: {
      error: {
        code,
        message: code,
        httpStatus: 410,
        meta: { revealId: "rvl_abc" },
      },
    },
  };
}

function renderCard(call: LangySecretSnippetCall = CALL) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangySecretSnippetCard organizationId="org_1" call={call} />
    </ChakraProvider>,
  );
}

function snippet(): string {
  return screen.getByTestId("langy-secret-snippet").textContent ?? "";
}

describe("LangySecretSnippetCard", () => {
  beforeEach(() => {
    revealOnce.mockClear();
    useLangySecretRevealStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  describe("given a reveal the server still holds", () => {
    beforeEach(() => {
      answer = async () => ({ secret: SECRET, preview: "vk-lw-01HZX9N" });
    });

    /** @scenario "The card reveals the secret on first render, with a copy button" */
    it("reads the secret once, shows the filled snippet, the shown-once line and a copy button", async () => {
      renderCard();
      await waitFor(() => {
        expect(screen.getByTestId("langy-secret-snippet-card")).toHaveAttribute(
          "data-state",
          "shown",
        );
      });
      expect(revealOnce).toHaveBeenCalledTimes(1);
      expect(revealOnce).toHaveBeenCalledWith({
        organizationId: "org_1",
        revealId: "rvl_abc",
      });
      expect(screen.getByText(LANGY_SECRET_SHOWN_ONCE_LINE)).toBeInTheDocument();
      expect(snippet()).toBe(
        `export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="${SECRET}"`,
      );
      expect(screen.getByRole("button", { name: "Copy the snippet" })).toBeInTheDocument();
    });

    it("spends the read once for two cards of the same call in this tab", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangySecretSnippetCard organizationId="org_1" call={CALL} />
          <LangySecretSnippetCard organizationId="org_1" call={CALL} />
        </ChakraProvider>,
      );
      await waitFor(() => {
        expect(screen.getAllByText(LANGY_SECRET_SHOWN_ONCE_LINE)).toHaveLength(2);
      });
      expect(revealOnce).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a reveal that was already read, before a reload or by another viewer", () => {
    /** @scenario "The card masks the secret once it has been revealed" */
    /** @scenario "A second viewer sees the masked card" */
    it("shows the masked snippet with the display prefix and the not-readable-again line", async () => {
      answer = async () => {
        throw refusal("secret_already_revealed");
      };
      renderCard();
      await waitFor(() => {
        expect(screen.getByTestId("langy-secret-snippet-card")).toHaveAttribute(
          "data-state",
          "gone",
        );
      });
      expect(screen.getByText(LANGY_SECRET_GONE_LINE)).toBeInTheDocument();
      expect(snippet()).toBe(
        'export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="vk-lw-01HZX9N..."',
      );
      expect(snippet()).not.toContain(SECRET);
      expect(screen.queryByRole("button", { name: "Copy the snippet" })).toBeNull();
    });
  });

  describe("given a reveal that expired", () => {
    /** @scenario "An expired reveal reads as gone" */
    it("shows the masked snippet and the not-readable-again line", async () => {
      answer = async () => {
        throw refusal("secret_reveal_expired");
      };
      renderCard({ ...CALL, preview: null });
      await waitFor(() => {
        expect(screen.getByText(LANGY_SECRET_GONE_LINE)).toBeInTheDocument();
      });
      expect(snippet()).toContain('OPENAI_API_KEY="vk-lw-..."');
    });
  });

  describe("given a read that failed for another reason", () => {
    it("says so, masks, and offers the read again", async () => {
      answer = async () => {
        throw new Error("fetch failed");
      };
      renderCard();
      await waitFor(() => {
        expect(screen.getByTestId("langy-secret-snippet-card")).toHaveAttribute(
          "data-state",
          "failed",
        );
      });
      expect(screen.getByRole("alert").textContent).toContain("I could not read the key");
      expect(screen.queryByText(LANGY_SECRET_GONE_LINE)).toBeNull();
      answer = async () => ({ secret: SECRET, preview: "vk-lw-01HZX9N" });
      screen.getByRole("button", { name: "Try again" }).click();
      await waitFor(() => {
        expect(screen.getByText(LANGY_SECRET_SHOWN_ONCE_LINE)).toBeInTheDocument();
      });
      expect(revealOnce).toHaveBeenCalledTimes(2);
    });
  });
});
