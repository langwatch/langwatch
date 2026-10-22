/**
 * The span pane's Prompt section: a braided span's prompt is its owner's (ADR-183 §7).
 * Spec: modules/trace/specs/braided-spans.feature
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { SpanDetail } from "@langwatch/trace-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  lookedUp: [] as (string | null)[],
}));

vi.mock("@langwatch/browser-host/drawer", () => ({ useDrawer: () => ({ openDrawer: vi.fn() }) }));
vi.mock("@langwatch/prompt-client", () => ({ PromptEditorDrawerToken: "prompt-editor" }));
vi.mock("../../../../../behavior/prompts/use-span-playground-href.ts", () => ({
  useSpanPlaygroundHref: () => (spanId: string) => `https://app.test/prompts?span=${spanId}`,
}));
vi.mock("../../../../../features/trace-drawer/behavior/use-prompt-by-handle.ts", () => ({
  usePromptByHandle: (handle: string | null) => {
    mocks.lookedUp.push(handle);
    return { resolvedHandle: handle ? "reader-prompt" : null };
  },
}));

import { PromptAccordion } from "../prompt-accordion.tsx";

function spanOf({ braided }: { braided: boolean }): SpanDetail {
  return {
    spanId: "span-7",
    parentSpanId: null,
    name: "decide charge",
    type: "llm",
    startTimeMs: 1,
    endTimeMs: 2,
    durationMs: 1,
    status: "ok",
    events: [],
    params: { "langwatch.prompt.id": "payments-decide:2" },
    braid: braided
      ? {
          ownerProjectId: "project_payments",
          ownerName: "payments-agent",
          ownerProjectSlug: null,
          canOpenOwner: false,
          matchedConditions: [],
          signedBy: null,
        }
      : null,
  };
}

afterEach(() => {
  cleanup();
  mocks.lookedUp.length = 0;
});

describe("given the Prompt section of a span braided in from another project", () => {
  /** @scenario "Actions that would act on the owner's data are off on a braided span, with a reason" */
  it("lists the prompt as the owner's, with opening it and the playground off", () => {
    render(
      <DesignSystemProvider>
        <PromptAccordion span={spanOf({ braided: true })} />
      </DesignSystemProvider>,
    );

    const reason = "Not available on spans braided from another project";
    expect(screen.getByText("payments-decide")).toBeInTheDocument();
    expect(screen.getByText("from payments-agent")).toBeInTheDocument();
    for (const label of ["Open prompt", "Open in Playground"]) {
      expect(screen.getByRole("button", { name: `${label}: ${reason}` })).toBeDisabled();
    }
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(mocks.lookedUp.every((handle) => handle === null)).toBe(true);
  });
});

describe("given the Prompt section of the reader's own span", () => {
  it("resolves the prompt among the reader's and offers its actions", () => {
    render(
      <DesignSystemProvider>
        <PromptAccordion span={spanOf({ braided: false })} />
      </DesignSystemProvider>,
    );

    expect(screen.getByText("reader-prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open prompt" })).toBeEnabled();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://app.test/prompts?span=span-7",
    );
  });
});
