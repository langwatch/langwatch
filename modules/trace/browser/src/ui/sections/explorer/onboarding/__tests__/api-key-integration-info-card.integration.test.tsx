// Minted-token card: full visibility (not masked), copy button, highlighted
// env block.
// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable state ────────────────────────────────────────────────────────────

let mockBaseHost: string | undefined;
// Captures the props the env block is rendered with so we can assert on the
// reveal + highlight decisions without depending on shiki's async render.
let capturedCodePreviewProps: Record<string, unknown> | null = null;

// ─── Dependency mocks (true boundaries) ─────────────────────────────────────────

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    apiKey: {
      create: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
  },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiDeployment: () => ({ appBaseUrl: mockBaseHost }),
}));

vi.mock("@langwatch/onboarding-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CodePreview: (props: Record<string, unknown>) => {
    capturedCodePreviewProps = props;
    return <div data-testid="code-preview">{String(props.code)}</div>;
  },
}));

// ─── Module under test ──────────────────────────────────────────────────────────

import { ApiKeyIntegrationInfoCard } from "../api-key-integration-info-card.tsx";

const TOKEN = "sk-lw-realtoken1234567890";
const PROJECT_ID = "project_test123";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedCodePreviewProps = null;
});

// Captured at assignment rather than read back off `navigator.clipboard`
// later: the Clipboard DOM type declares writeText with method shorthand, so
// `expect(navigator.clipboard.writeText)` would extract it unbound.
let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockBaseHost = undefined; // cloud default — no LANGWATCH_ENDPOINT line
  clipboardWriteText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWriteText },
  });
});

function renderCard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ApiKeyIntegrationInfoCard
        organizationId="org-1"
        projectId={PROJECT_ID}
        token={TOKEN}
        onTokenGenerated={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("<ApiKeyIntegrationInfoCard /> with a minted token", () => {
  describe("when the token has been generated", () => {
    it("shows the shown-once warning", () => {
      renderCard();
      expect(screen.getByText(/Copy this token before you move on\./i)).toBeInTheDocument();
    });

    it("reveals the token in full by default rather than masking it", () => {
      renderCard();
      expect(capturedCodePreviewProps?.isVisible).toBe(true);
      // The real token (not a sk-l***...***rKF mask) is handed to the block.
      expect(screen.getByTestId("code-preview")).toHaveTextContent(TOKEN);
      expect(screen.getByTestId("code-preview")).toHaveTextContent(PROJECT_ID);
    });

    it("renders a copy button right after the warning", () => {
      renderCard();
      const warning = screen.getByText(/Copy this token before you move on\./i);
      const copyButton = screen.getByRole("button", { name: /copy token/i });
      // The copy button follows the warning sentence in document order.
      expect(
        warning.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("copies the raw token when the copy button is clicked", async () => {
      renderCard();
      fireEvent.click(screen.getByRole("button", { name: /copy token/i }));
      await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(TOKEN));
    });

    it("highlights every env line on cloud (api key + project id)", () => {
      renderCard();
      // Cloud: LANGWATCH_API_KEY (1) + LANGWATCH_PROJECT_ID (2).
      expect(capturedCodePreviewProps?.highlightLines).toEqual([1, 2]);
    });
  });

  describe("when the deployment is self-hosted", () => {
    it("highlights the endpoint line too so the whole block stands out", () => {
      mockBaseHost = "https://langwatch.acme.internal";
      renderCard();
      // Self-hosted adds LANGWATCH_ENDPOINT (3) — all three lines highlight.
      expect(capturedCodePreviewProps?.highlightLines).toEqual([1, 2, 3]);
    });
  });
});
