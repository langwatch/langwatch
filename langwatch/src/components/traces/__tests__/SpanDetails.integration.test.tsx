/**
 * @vitest-environment jsdom
 *
 * Integration tests for the SpanDetails component.
 * Covers the "Open in Prompts" button/menu behavior based on prompt reference presence.
 *
 * @see specs/prompts/open-existing-prompt-from-trace.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("next/router", () => ({
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails project={project} span={span} />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails project={project} span={span} />
        </ChakraProvider>,
      );

      const link = screen.getByRole("link", {
        name: /Open in Prompts/i,
      });
      expect(link).toBeDefined();
    });

    it("links to playground without action parameter", () => {
      const span = buildLLMSpan({ params: null });

      render(
        <ChakraProvider value={defaultSystem}>
          <SpanDetails project={project} span={span} />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[grandparent, parent, llmSpan]}
          />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, siblingSpan, llmSpan]}
          />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails project={project} span={span} />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails project={project} span={span} />
        </ChakraProvider>,
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
        <ChakraProvider value={defaultSystem}>
          <SpanDetails
            project={project}
            span={llmSpan}
            allSpans={[parentSpan, llmSpan]}
          />
        </ChakraProvider>,
      );

      const button = screen.getByRole("button", {
        name: /Open in Prompts/i,
      });
      expect(button).toBeDefined();
    });
  });
});
