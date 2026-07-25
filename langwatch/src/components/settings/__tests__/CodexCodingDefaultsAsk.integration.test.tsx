/**
 * @vitest-environment jsdom
 *
 * The page-level coding-defaults ask (spec:
 * specs/model-providers/codex-account-provider.feature). The codex drawer
 * closes itself when its sign-in completes and queues this ask; the
 * model-providers page hosts the dialog so it outlives the drawer. Accepting
 * runs the same LANGY+FAST role writes the Langy setup performs inline, and
 * snaps Langy's model pill to the new default when the pill was following
 * the old one.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "~/features/langy/stores/langyStore";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockApplyCodingDefaults,
  mockResolvedDefaultQuery,
  mockInvalidate,
  mockGetResolvedData,
  mockFetchResolved,
} = vi.hoisted(() => ({
  mockApplyCodingDefaults: vi.fn(),
  mockResolvedDefaultQuery: vi.fn(),
  mockInvalidate: vi.fn(),
  mockGetResolvedData: vi.fn(),
  mockFetchResolved: vi.fn(),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    useUtils: () => ({
      modelProvider: {
        invalidate: mockInvalidate,
        getResolvedDefault: {
          getData: mockGetResolvedData,
          fetch: mockFetchResolved,
        },
      },
    }),
    modelProvider: {
      getResolvedDefault: { useQuery: mockResolvedDefaultQuery },
      codexApplyCodingDefaults: {
        useMutation: () => ({
          mutateAsync: mockApplyCodingDefaults,
          isLoading: false,
        }),
      },
    },
  },
}));

// Import after mocks
import {
  CodexCodingDefaultsAskHost,
  useCodexCodingDefaultsAskStore,
} from "../CodexCodingDefaultsAsk";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-1";
const ASK_SCOPES = [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }];
const OLD_DEFAULT = "openai/gpt-5.5";
const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

function renderHost() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CodexCodingDefaultsAskHost />
    </ChakraProvider>,
  );
}

function primeResolvedDefault(model: string | null) {
  mockResolvedDefaultQuery.mockReturnValue({
    data: model ? { model } : null,
    isLoading: false,
    isError: false,
  });
  mockGetResolvedData.mockReturnValue(model ? { model } : null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: Codex coding-defaults ask on the model-providers page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCodexCodingDefaultsAskStore.setState({ pending: null });
    useLangyStore.getState().setModelOverride("");
    mockInvalidate.mockResolvedValue(void 0);
    mockFetchResolved.mockResolvedValue({ model: CODEX_MODEL });
    mockApplyCodingDefaults.mockResolvedValue({ applied: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a completed sign-in queued the ask and the default is not codex", () => {
    beforeEach(() => {
      primeResolvedDefault(OLD_DEFAULT);
      useCodexCodingDefaultsAskStore
        .getState()
        .request({ projectId: PROJECT_ID, scopes: ASK_SCOPES });
    });

    /** @scenario Connecting Codex from settings asks before touching defaults */
    it("asks whether Codex should become the coding default", async () => {
      renderHost();
      expect(
        await screen.findByText("Set Codex as your coding default?"),
      ).toBeTruthy();
    });

    it("keeps the description short and lists every fast assist in the info tooltip", async () => {
      renderHost();

      // The description names the gist only; the full assist list lives
      // behind the (i), per dev/docs/best_practices/copywriting.md.
      expect(
        await screen.findByText(
          /Langy and the fast AI assists\s*across LangWatch will run/,
        ),
      ).toBeTruthy();

      fireEvent.click(screen.getByLabelText("More info"));

      expect(
        await screen.findByText(
          "The fast assists are the small AI helpers across the product: search, chat titles, autocomplete, and translations.",
        ),
      ).toBeTruthy();
    });

    describe("when the user accepts", () => {
      /** @scenario Connecting Codex from settings asks before touching defaults */
      it("applies the defaults at the scopes the sign-in saved at", async () => {
        renderHost();
        fireEvent.click(
          await screen.findByRole("button", { name: "Set as default" }),
        );

        await waitFor(() =>
          expect(mockApplyCodingDefaults).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            scopes: ASK_SCOPES,
          }),
        );
        await waitFor(() =>
          expect(useCodexCodingDefaultsAskStore.getState().pending).toBeNull(),
        );
      });

      /** @scenario Langy's model pill follows the new coding default immediately */
      it("snaps Langy's model pill to the codex model when it was following the old default", async () => {
        useLangyStore.getState().setModelOverride(OLD_DEFAULT);
        renderHost();

        fireEvent.click(
          await screen.findByRole("button", { name: "Set as default" }),
        );

        await waitFor(() =>
          expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL),
        );
        expect(mockInvalidate).toHaveBeenCalled();
      });

      /** @scenario A model the user picked on purpose is not hijacked */
      it("keeps a model the user explicitly picked", async () => {
        useLangyStore.getState().setModelOverride("anthropic/claude-sonnet-5");
        renderHost();

        fireEvent.click(
          await screen.findByRole("button", { name: "Set as default" }),
        );

        await waitFor(() => expect(mockApplyCodingDefaults).toHaveBeenCalled());
        await waitFor(() =>
          expect(useCodexCodingDefaultsAskStore.getState().pending).toBeNull(),
        );
        expect(useLangyStore.getState().modelOverride).toBe(
          "anthropic/claude-sonnet-5",
        );
      });
    });

    describe("when the user declines", () => {
      /** @scenario Connecting Codex from settings asks before touching defaults */
      it("touches no default and clears the ask", async () => {
        renderHost();
        fireEvent.click(await screen.findByRole("button", { name: "Not now" }));

        await waitFor(() =>
          expect(useCodexCodingDefaultsAskStore.getState().pending).toBeNull(),
        );
        expect(mockApplyCodingDefaults).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the Langy default already resolves to a codex model", () => {
    beforeEach(() => {
      primeResolvedDefault(CODEX_MODEL);
      useCodexCodingDefaultsAskStore
        .getState()
        .request({ projectId: PROJECT_ID, scopes: ASK_SCOPES });
    });

    /** @scenario Re-authenticating does not re-ask an already-answered question */
    it("never shows the dialog and clears the queued ask", async () => {
      renderHost();

      await waitFor(() =>
        expect(useCodexCodingDefaultsAskStore.getState().pending).toBeNull(),
      );
      expect(
        screen.queryByText("Set Codex as your coding default?"),
      ).toBeNull();
    });
  });
});
