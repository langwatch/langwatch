/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  LangyToolActivity,
  toActivityGroups,
  toFailedToolCalls,
} from "../components/LangyToolActivity";

const TRACE_ID = "2ab7ff6b8f025b66f51978a127f956bb";
const TRACE_URL = `http://127.0.0.1:3000/explore?trace=${TRACE_ID}`;
const LOGS_URL = `http://127.0.0.1:3000/explore?logs=${TRACE_ID}`;

function message(errorText: string): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        state: "output-error",
        input: {
          command:
            "langwatch trace search --has-error --start-date 24h --format json",
        },
        errorText,
      } as never,
    ],
  };
}

function structuredFailure(): string {
  return [
    JSON.stringify({
      ok: false,
      error: {
        kind: "network_error",
        message: "Failed to search traces: socket hang up (ECONNRESET).",
        httpStatus: 0,
        meta: {
          trace: {
            traceId: TRACE_ID,
            traceUrl: TRACE_URL,
            logsUrl: LOGS_URL,
          },
        },
        isDomain: false,
      },
    }),
    "Failed to search traces: socket hang up (ECONNRESET).",
  ].join("\n");
}

/** The shape the CURRENT CLI writes: trace links top-level, code + kind. */
function structuredFailureNewCli(): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: "network_error",
      kind: "network_error",
      message: "Failed to search traces: socket hang up (ECONNRESET).",
      httpStatus: 0,
      meta: {},
      isHandled: false,
      traceId: TRACE_ID,
      traceUrl: TRACE_URL,
      logsUrl: LOGS_URL,
    },
  });
}

describe("Langy tool failure card", () => {
  it("renders the failure and Grafana diagnostics as card actions", () => {
    const value = message(structuredFailure());
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={value} />
      </ChakraProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Searching traces failed");
    expect(alert.textContent).toContain("socket hang up");
    expect(alert.textContent).toContain(TRACE_ID);
    expect(
      screen.getByRole("link", { name: /open debug trace/i }),
    ).toHaveAttribute("href", TRACE_URL);
    expect(
      screen.getByRole("link", { name: /open related logs/i }),
    ).toHaveAttribute("href", LOGS_URL);
    // URLs are actions, not an unreadable paragraph in the card.
    expect(alert.textContent).not.toContain(TRACE_URL);
    expect(alert.textContent).not.toContain(LOGS_URL);
  });

  it("reads the trace/logs actions off a new-CLI document's top-level fields", () => {
    const value = message(structuredFailureNewCli());
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={value} />
      </ChakraProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain(TRACE_ID);
    expect(
      screen.getByRole("link", { name: /open debug trace/i }),
    ).toHaveAttribute("href", TRACE_URL);
    expect(
      screen.getByRole("link", { name: /open related logs/i }),
    ).toHaveAttribute("href", LOGS_URL);
  });

  it("does not render a failed call as successful activity", () => {
    const value = message(structuredFailure());

    expect(toFailedToolCalls(value)).toHaveLength(1);
    expect(toActivityGroups(value)).toHaveLength(0);
  });

  it("turns an output-available CLI failure into an error card", () => {
    const value = {
      id: "assistant-cli-error",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-cli-error",
          // The CLI adapter occasionally marks a handled command failure as
          // output-available because the shell itself exited cleanly.
          state: "output-available",
          input: { command: "langwatch trace search --format json" },
          output: JSON.stringify({
            kind: "text",
            text: "- Searching traces...\n✖ Failed to search traces: fetch failed (SELF_SIGNED_CERT_IN_CHAIN: self-signed certificate in certificate chain)",
          }),
        },
      ],
    } as UIMessage;

    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={value} />
      </ChakraProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Failed to search traces",
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "No traces were returned",
    );
    expect(toActivityGroups(value)).toHaveLength(0);
  });

  it("does not expose an unstructured tool error to a normal user", () => {
    const value = message(
      "Prisma LangyConversationProjection findUnique SQL host=db.internal",
    );

    const [failure] = toFailedToolCalls(value);
    expect(failure?.presentation.message).toBe(
      "This step couldn't be completed.",
    );
    expect(JSON.stringify(failure?.presentation)).not.toContain("Prisma");
    expect(JSON.stringify(failure?.presentation)).not.toContain("db.internal");
  });

  it("collapses a mis-associated trace-search payload into a receipt", () => {
    const value = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-search",
          state: "output-available",
          input: { command: "langwatch trace search --format json" },
          // This is a scalar from an unrelated tool, not a trace result.
          output: '{"value":"unrelated previous tool result"}',
        },
      ],
    } as UIMessage;

    const [group] = toActivityGroups(value);
    expect(group?.done).toBe(true);
    expect(group?.label).toMatch(/searching traces/i);
  });
});
