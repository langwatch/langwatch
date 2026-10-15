/**
 * @vitest-environment jsdom
 * The foundry span editors on the Card shapes: tinted wells, role-edged message rows, and the
 * add, edit and remove behaviour that writes to the trace store.
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import { createDefaultTrace, useTraceStore } from "../behavior/trace.store.ts";
import type { SpanConfig } from "../model/foundry-types.ts";
import { LLMSpanEditor } from "../ui/sections/llm-span-editor.tsx";
import { PromptSpanEditor } from "../ui/sections/prompt-span-editor.tsx";
import { RAGSpanEditor } from "../ui/sections/rag-span-editor.tsx";
import { SpanEditorPanel } from "../ui/sections/span-editor-panel.tsx";

afterEach(cleanup);

function seed(patch: Partial<SpanConfig>): SpanConfig {
  const trace = createDefaultTrace();
  const first = trace.spans[0];
  if (!first) throw new Error("default trace should seed one span");
  const span = { ...first, ...patch };
  useTraceStore.setState({ trace: { ...trace, spans: [span] }, selectedSpanId: span.id });
  return span;
}

function current(): SpanConfig {
  const span = useTraceStore.getState().trace.spans[0];
  if (!span) throw new Error("expected a span");
  return span;
}

function wellOf(heading: string): HTMLElement {
  const well = screen.getByRole("heading", { name: heading }).closest("[data-card-variant]");
  if (!(well instanceof HTMLElement)) throw new Error("expected the heading inside a card");
  return well;
}

describe("the RAG span editor", () => {
  beforeEach(() => {
    seed({
      type: "rag",
      rag: { contexts: [{ document_id: "doc-1", chunk_id: "c-1", content: "first" }] },
    });
  });

  it("is a teal well whose contexts are neutral insets", () => {
    const span = current();
    renderWithOpsHost(<RAGSpanEditor span={span} />);

    expect(wellOf("RAG Contexts").dataset).toMatchObject({
      cardVariant: "nested",
      cardTone: "teal",
    });
    const contexts = document.querySelectorAll("[data-card-tone='neutral']");
    expect(contexts).toHaveLength(1);
  });

  it("adds, edits and removes a context in the trace store", async () => {
    const user = userEvent.setup();
    renderWithOpsHost(<RAGSpanEditor span={current()} />);

    await user.click(screen.getByRole("button", { name: /Add Context/ }));
    expect(current().rag?.contexts).toHaveLength(2);
    cleanup();
    renderWithOpsHost(<RAGSpanEditor span={current()} />);
    const ids = screen.getAllByPlaceholderText("Document ID");
    await user.type(ids[1] as HTMLElement, "d");
    expect(current().rag?.contexts[1]?.document_id).toBe("d");
    cleanup();
    renderWithOpsHost(<RAGSpanEditor span={current()} />);
    const wells = document.querySelectorAll<HTMLElement>("[data-card-tone='neutral']");
    await user.click(within(wells[0] as HTMLElement).getByRole("button"));
    expect(current().rag?.contexts).toEqual([{ document_id: "d", chunk_id: "", content: "" }]);
  });
});

describe("the LLM span editor", () => {
  beforeEach(() => {
    seed({
      type: "llm",
      llm: {
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "tool", content: "42" },
        ],
      },
    });
  });

  it("is a blue well with one accent row per message, coloured by role", () => {
    renderWithOpsHost(<LLMSpanEditor span={current()} />);

    expect(wellOf("LLM Configuration").dataset.cardTone).toBe("blue");
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-card-variant='accent-row']"),
    );
    expect(rows.map((row) => row.dataset.cardTone)).toEqual(["purple", "green", "blue", "yellow"]);
    expect(screen.getByRole("combobox", { name: "Message 2 role" })).toBeTruthy();
  });

  it("falls back to a neutral edge for a role it does not know", () => {
    seed({ type: "llm", llm: { messages: [{ role: "developer" as never, content: "x" }] } });
    renderWithOpsHost(<LLMSpanEditor span={current()} />);

    expect(
      document.querySelector("[data-card-variant='accent-row']")?.getAttribute("data-card-tone"),
    ).toBe("neutral");
  });

  it("edits and removes a message in the trace store", async () => {
    const user = userEvent.setup();
    renderWithOpsHost(<LLMSpanEditor span={current()} />);

    const rows = document.querySelectorAll<HTMLElement>("[data-card-variant='accent-row']");
    await user.type(within(rows[1] as HTMLElement).getByPlaceholderText("Message content..."), "!");
    expect(current().llm?.messages?.[1]?.content).toBe("hi!");
    await user.click(within(rows[0] as HTMLElement).getByRole("button"));
    expect(current().llm?.messages).toHaveLength(3);
  });
});

describe("the prompt span editor", () => {
  it("is a yellow well and keeps its variables editable", async () => {
    seed({ type: "prompt", prompt: { variables: { name: "Ada" } } });
    const user = userEvent.setup();
    renderWithOpsHost(<PromptSpanEditor span={current()} />);

    expect(wellOf("Prompt Configuration").dataset.cardTone).toBe("yellow");
    await user.click(screen.getByRole("button", { name: /Add Variable/ }));
    expect(Object.keys(current().prompt?.variables ?? {})).toEqual(["name", "var_2"]);
  });
});

describe("the span editor panel", () => {
  it("draws an errored span's exception as a red well with its fields", async () => {
    seed({ status: "error", exception: { message: "boom" } });
    const user = userEvent.setup();
    renderWithOpsHost(<SpanEditorPanel />);

    expect(wellOf("Exception").dataset).toMatchObject({ cardVariant: "nested", cardTone: "red" });
    await user.type(screen.getByPlaceholderText("Error message"), "!");
    expect(current().exception?.message).toBe("boom!");
  });
});
