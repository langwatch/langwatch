/**
 * @vitest-environment jsdom
 *
 * Matching-spans preview inside the LLM model cost drawer: real component
 * tree (drawer + form + preview), with the tRPC client as the mocked
 * boundary.
 *
 * Spec: specs/model-providers/model-cost-matching-spans-preview.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMModelCostDrawer } from "~/components/settings/LLMModelCostDrawer";

const { mockPreviewState, mockPreviewQueryInputs } = vi.hoisted(() => ({
  mockPreviewState: {
    current: null as null | {
      windowDays: number;
      totalMatchedSpans: number;
      matchedModels: Array<{
        model: string;
        spanCount: number;
        lastSeenMs: number;
      }>;
      sampleSpans: Array<{
        traceId: string;
        spanId: string;
        spanName: string;
        model: string;
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        cacheCreationTokens: number | null;
        startTimeMs: number;
        exampleCost: number | null;
      }>;
      unmatchedModels: Array<{ model: string; spanCount: number }>;
    },
  },
  mockPreviewQueryInputs: [] as Array<{
    input: Record<string, unknown>;
    enabled: boolean | undefined;
  }>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Org One" },
    team: { id: "team-1", name: "Team One" },
    project: { id: "proj-1", slug: "test-project", name: "Test Project" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
      },
      createOrUpdate: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      previewMatchingSpans: {
        useQuery: (
          input: Record<string, unknown>,
          opts?: { enabled?: boolean },
        ) => {
          mockPreviewQueryInputs.push({ input, enabled: opts?.enabled });
          return {
            data:
              opts?.enabled === false ? undefined : mockPreviewState.current,
            isLoading: false,
          };
        },
      },
    },
  },
}));

const Wrapper = ({ children }: { children?: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(
  props: { id?: string; prefillModel?: string; prefillRegex?: string } = {},
) {
  return render(<LLMModelCostDrawer {...props} />, { wrapper: Wrapper });
}

const T_START = 1_750_000_000_000;

describe("Feature: Model cost regex matching spans preview", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPreviewQueryInputs.length = 0;
    vi.spyOn(window, "open").mockReturnValue(null);
    mockPreviewState.current = {
      windowDays: 7,
      totalMatchedSpans: 12,
      matchedModels: [
        {
          model: "bedrock/eu.anthropic.claude-sonnet-4-6",
          spanCount: 12,
          lastSeenMs: T_START,
        },
      ],
      sampleSpans: [
        {
          traceId: "trace-1",
          spanId: "span-1",
          spanName: "chat completion",
          model: "bedrock/eu.anthropic.claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          startTimeMs: T_START,
          exampleCost: 0.006,
        },
      ],
      unmatchedModels: [],
    };
  });

  describe("when recent spans match the regex", () => {
    /** @scenario Recent spans matching the regex are listed with tokens and an example cost */
    it("lists the spans with model, tokens, and example cost", () => {
      renderDrawer({ prefillRegex: "bedrock/eu\\." });

      const row = screen.getByTestId("matching-span-row");
      expect(row).toHaveTextContent("bedrock/eu.anthropic.claude-sonnet-4-6");
      expect(row).toHaveTextContent("chat completion");
      expect(row).toHaveTextContent("1.0K");
      expect(row).toHaveTextContent("200");
      expect(row).toHaveTextContent("$0.0060");
      expect(
        screen.getByText("12 spans across 1 model in the last 7 days"),
      ).toBeInTheDocument();
    });

    /** @scenario A span row opens the trace details drawer in a new tab */
    it("opens the trace drawer deep link in a new tab on row click", () => {
      renderDrawer({ prefillRegex: "bedrock/eu\\." });

      fireEvent.click(screen.getByTestId("matching-span-row"));

      expect(window.open).toHaveBeenCalledTimes(1);
      const [url, target] = vi.mocked(window.open).mock.calls[0]!;
      const parsed = new URL(`http://localhost${url as string}`);
      expect(parsed.pathname).toBe("/test-project/traces");
      expect(parsed.searchParams.get("drawer.open")).toBe("traceV2Details");
      expect(parsed.searchParams.get("drawer.traceId")).toBe("trace-1");
      expect(parsed.searchParams.get("drawer.span")).toBe("span-1");
      expect(parsed.searchParams.get("drawer.t")).toBe(String(T_START));
      expect(parsed.searchParams.get("drawer.mode")).toBe("trace");
      expect(target).toBe("_blank");
    });

    it("does not submit the form when a span row is clicked", () => {
      renderDrawer({ prefillRegex: "bedrock/eu\\." });

      fireEvent.click(screen.getByTestId("matching-span-row"));

      // Save submission would render the regex input invalid or fire the
      // mutation; cheapest observable: the drawer is still rendered and no
      // navigation/mutation happened.
      expect(screen.getByTestId("matching-spans-preview")).toBeInTheDocument();
    });
  });

  describe("when no spans match the regex", () => {
    beforeEach(() => {
      mockPreviewState.current = {
        windowDays: 7,
        totalMatchedSpans: 0,
        matchedModels: [],
        sampleSpans: [],
        unmatchedModels: [
          { model: "bedrock/eu.anthropic.claude-sonnet-4-6", spanCount: 42 },
          { model: "gpt-5-mini", spanCount: 7 },
        ],
      };
    });

    /** @scenario No matches shows the models that were seen instead */
    it("shows the recently seen models that did not match", () => {
      renderDrawer({ prefillRegex: "nothing-matches-this" });

      expect(
        screen.getByText("no matches in the last 7 days"),
      ).toBeInTheDocument();
      const chips = screen.getAllByTestId("unmatched-model-chip");
      expect(chips).toHaveLength(2);
      expect(chips[0]).toHaveTextContent(
        "bedrock/eu.anthropic.claude-sonnet-4-6",
      );
      expect(chips[0]).toHaveTextContent("42");
    });

    it("fills an exact-match regex and the model name when a model chip is clicked", () => {
      renderDrawer({ prefillRegex: "nothing-matches-this" });

      fireEvent.click(screen.getAllByTestId("unmatched-model-chip")[0]!);

      expect(
        screen.getByDisplayValue(
          "^bedrock\\/eu\\.anthropic\\.claude-sonnet-4-6$",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("bedrock/eu.anthropic.claude-sonnet-4-6"),
      ).toBeInTheDocument();
    });
  });

  describe("when the regex is invalid", () => {
    it("disables the preview query and asks for a valid regex", () => {
      renderDrawer({ prefillRegex: "(a+)+$" });

      expect(
        screen.getByText(
          "Enter a valid regular expression to preview the spans it would match.",
        ),
      ).toBeInTheDocument();
      expect(
        mockPreviewQueryInputs.every((call) => call.enabled === false),
      ).toBe(true);
    });
  });

  describe("when a slash appears unescaped in the regex", () => {
    /** @scenario Slashes in the regex are valid */
    it("treats the regex as valid and previews matches", () => {
      renderDrawer({
        prefillRegex: "^bedrock/eu\\.anthropic\\.claude-sonnet-4-6$",
      });

      expect(screen.getByTestId("matching-span-row")).toBeInTheDocument();
      expect(
        mockPreviewQueryInputs.some((call) => call.enabled !== false),
      ).toBe(true);
    });
  });

  describe("when opened from the add cost mapping deep link", () => {
    it("prefills the model name and regex fields", () => {
      renderDrawer({
        prefillModel: "vertex_ai/gemini-3-pro-preview",
        prefillRegex: "^vertex_ai\\/gemini-3-pro-preview$",
      });

      expect(
        screen.getByDisplayValue("vertex_ai/gemini-3-pro-preview"),
      ).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("^vertex_ai\\/gemini-3-pro-preview$"),
      ).toBeInTheDocument();
    });
  });
});
