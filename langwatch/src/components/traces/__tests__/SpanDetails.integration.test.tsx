/**
 * @vitest-environment jsdom
 *
 * Integration tests for the SpanDetails component.
 * Covers the "Open in Prompts" button/menu behavior based on prompt reference presence.
 *
 * @see specs/prompts/open-existing-prompt-from-trace.feature
 */
import React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@prisma/client";
import type { Span } from "../../../server/tracer/types";
import { SpanDetails } from "../SpanDetails";

const mockBuildUrl = vi.fn((spanId: string, action?: string) => {
  const url = new URL("http://localhost/test-project/prompts");
  url.searchParams.set("promptPlaygroundSpanId", spanId);
  if (action) {
    url.searchParams.set("action", action);
  }
  return url;
});

vi.mock(
  "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground",
  () => ({
    useGoToSpanInPlaygroundTabUrlBuilder: () => ({
      buildUrl: mockBuildUrl,
    }),
  }),
);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
    replace: vi.fn(),
    pathname: "/test-project",
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } }, status: "authenticated" }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    team: { id: "team_1" },
  }),
}));

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: () => false,
    redact: (v: string) => v,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({}),
  },
}));

const project = { id: "proj_1", slug: "test-project" } as Project;

// Wrapper providing Router context (Link components need it), ChakraProvider,
// and Suspense (needed for React.lazy components used by dynamic() compat)
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <React.Suspense fallback={<div>Loading...</div>}>
          {children}
        </React.Suspense>
      </ChakraProvider>
    </MemoryRouter>
  );
}

function buildLLMSpan(overrides: Partial<Span> = {}): Span {
  return {
    span_id: "span-123",
    trace_id: "trace-456",
    name: "test-llm-call",
    type: "llm",
    model: "gpt-4",
    vendor: "openai",
    input: {
      type: "chat_messages",
      value: [{ role: "user", content: "Hello" }],
    },
    output: {
      type: "chat_messages",
      value: [{ role: "assistant", content: "Hi!" }],
    },
    timestamps: {
      started_at: Date.now() - 1000,
      finished_at: Date.now(),
    },
    params: null,
    ...overrides,
  } as Span;
}

afterEach(() => {
  cleanup();
  mockBuildUrl.mockClear();
});

describe("<SpanDetails/>", () => {
  describe("when span has prompt reference in params", () => {
    it("renders a dropdown menu trigger button", () => {
      const span = buildLLMSpan({
        params: {
          langwatch: {
            prompt: {
              id: "team/sample-prompt:3",
            },
          },
        },
      });

      render(
        <TestWrapper>
          <SpanDetails project={project} span={span} />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });
  });

  describe("when span has no prompt reference in params", () => {
    it("renders a simple link button", () => {
      const span = buildLLMSpan({ params: null });

      render(
        <TestWrapper>
          <SpanDetails project={project} span={span} />
        </TestWrapper>,
      );

      const link = screen.getByRole("link", {
        name: /Open in Prompts/i,
      });
      expect(link).toBeDefined();
    });

    it("links to playground without action parameter", () => {
      const span = buildLLMSpan({ params: null });

      render(
        <TestWrapper>
          <SpanDetails project={project} span={span} />
        </TestWrapper>,
      );

      expect(mockBuildUrl).toHaveBeenCalledWith("span-123");
    });
  });

  describe("when prompt reference is on parent span (ancestor lookup)", () => {
    it("renders a dropdown menu trigger button", () => {
      const parentSpan = buildLLMSpan({
        span_id: "parent-span",
        type: "span" as Span["type"],
        params: {
          langwatch: {
            prompt: {
              id: "team/sample-prompt:3",
            },
          },
        },
      });
      const llmSpan = buildLLMSpan({
        span_id: "span-123",
        parent_id: "parent-span",
        params: null,
      });

      render(
        <TestWrapper>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });

    it("finds prompt reference on grandparent span", () => {
      const grandparent = buildLLMSpan({
        span_id: "grandparent-span",
        type: "span" as Span["type"],
        params: {
          langwatch: {
            prompt: {
              id: "org/deep-prompt:7",
            },
          },
        },
      });
      const parent = buildLLMSpan({
        span_id: "parent-span",
        parent_id: "grandparent-span",
        type: "span" as Span["type"],
        params: null,
      });
      const llmSpan = buildLLMSpan({
        span_id: "span-123",
        parent_id: "parent-span",
        params: null,
      });

      render(
        <TestWrapper>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[grandparent, parent, llmSpan]}
          />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });

    it("renders simple link when no ancestor has prompt reference", () => {
      const parentSpan = buildLLMSpan({
        span_id: "parent-span",
        type: "span" as Span["type"],
        params: null,
      });
      const llmSpan = buildLLMSpan({
        span_id: "span-123",
        parent_id: "parent-span",
        params: null,
      });

      render(
        <TestWrapper>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </TestWrapper>,
      );

      const link = screen.getByRole("link", {
        name: /Open in Prompts/i,
      });
      expect(link).toBeDefined();
    });
  });

  describe("when prompt reference is on a sibling span (not parent)", () => {
    it("renders a dropdown menu trigger button", () => {
      const parentSpan = buildLLMSpan({
        span_id: "parent-span",
        type: "span" as Span["type"],
        params: null,
      });
      const siblingSpan = buildLLMSpan({
        span_id: "sibling-span",
        parent_id: "parent-span",
        type: "span" as Span["type"],
        timestamps: {
          started_at: Date.now() - 2000,
          finished_at: Date.now() - 1500,
        },
        params: {
          langwatch: {
            prompt: {
              id: "team/sibling-prompt:2",
            },
          },
        },
      });
      const llmSpan = buildLLMSpan({
        span_id: "span-123",
        parent_id: "parent-span",
        params: null,
      });

      render(
        <TestWrapper>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, siblingSpan, llmSpan]}
          />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });
  });

  describe("when span is not an LLM type", () => {
    it("does not render any Open in Prompts button", () => {
      const span = buildLLMSpan({ type: "span" as Span["type"] });

      render(
        <TestWrapper>
          <SpanDetails project={project} span={span} />
        </TestWrapper>,
      );

      const buttons = screen.queryAllByText(/Open in Prompts/i);
      expect(buttons).toHaveLength(0);
    });
  });

  describe("when span has a tagged prompt reference in params", () => {
    it("renders a dropdown menu trigger button", () => {
      const span = buildLLMSpan({
        params: {
          langwatch: {
            prompt: {
              id: "team/sample-prompt:production",
            },
          },
        },
      });

      render(
        <TestWrapper>
          <SpanDetails project={project} span={span} />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });
  });

  describe("when tagged prompt reference is on parent span", () => {
    it("renders a dropdown menu trigger button for tag-based ancestor reference", () => {
      const parentSpan = buildLLMSpan({
        span_id: "parent-span",
        type: "span" as Span["type"],
        params: {
          langwatch: {
            prompt: {
              id: "team/sample-prompt:production",
            },
          },
        },
      });
      const llmSpan = buildLLMSpan({
        span_id: "span-123",
        parent_id: "parent-span",
        params: null,
      });

      render(
        <TestWrapper>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </TestWrapper>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });
  });
});
