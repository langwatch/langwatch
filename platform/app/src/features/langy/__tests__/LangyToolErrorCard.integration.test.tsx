/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
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

  // A failure with no document still has TEXT, and the text is the only thing
  // left that knows anything. It used to be swallowed in favour of "This step
  // couldn't be completed", which told the reader nothing and told support less.
  it("shows an unstructured tool error rather than swallowing it", () => {
    const value = message("psql: connection to server failed: no such host");

    const [failure] = toFailedToolCalls(value);
    expect(failure?.presentation.message).toBe(
      "This step couldn't be completed.",
    );
    expect(failure?.presentation.detail).toContain("connection to server");
    // It claims no code it was never given.
    expect(failure?.presentation.code).toBeUndefined();
  });

  // A count that hit a malformed response printed a Python traceback, and the
  // card lifted "json.decoder.JSONDecodeError: ..." out of it and drew it as the
  // body. The engine's own words are never card copy.
  describe("given a Python traceback and no structured failure", () => {
    const TRACEBACK = [
      "Traceback (most recent call last):",
      '  File "/app/langwatch_nlp/count.py", line 42, in count_rows',
      "    payload = json.loads(response.text)",
      "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    ].join("\n");

    /** @scenario "The traceback stays reachable behind the disclosure" */
    it("keeps the traceback out of the card body", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={message(TRACEBACK)} />
        </ChakraProvider>,
      );

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("This step couldn't be completed.");
      expect(alert.textContent).not.toContain("JSONDecodeError");
      expect(alert.textContent).not.toContain(
        "Traceback (most recent call last)",
      );
    });

    /** @scenario "The traceback stays reachable behind the disclosure" */
    it("reveals the whole traceback behind the disclosure", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={message(TRACEBACK)} />
        </ChakraProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /show details/i }));

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("JSONDecodeError");
      expect(alert.textContent).toContain("Traceback (most recent call last)");
    });
  });

  it("renders a failure's code so it can be quoted", () => {
    const value = message(structuredFailureNewCli());

    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={value} />
      </ChakraProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain("network_error");
    expect(
      screen.getByRole("button", { name: /copy the error details/i }),
    ).toBeTruthy();
  });

  // The red card used to render ABOVE the receipt for the steps that ran BEFORE
  // it, because the transcript was grouped by kind rather than sequenced.
  it("places a failure after the steps that preceded it", () => {
    const value = {
      id: "assistant-ordered",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-read",
          state: "output-available",
          input: { command: "cat notes.md" },
          output: "ok",
        },
        {
          type: "tool-bash",
          toolCallId: "call-edit",
          state: "output-available",
          input: { command: "sed -i s/a/b/ notes.md" },
          output: "ok",
        },
        {
          type: "tool-bash",
          toolCallId: "call-failed",
          state: "output-error",
          input: { command: "langwatch scenario create Demo --format json" },
          errorText: structuredFailureNewCli(),
        },
      ],
    } as UIMessage;

    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={value} />
      </ChakraProvider>,
    );

    const transcript = screen.getByLabelText("Langy activity");
    const alert = screen.getByRole("alert");
    const rows = [...transcript.children];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.findIndex((row) => row.contains(alert))).toBe(rows.length - 1);
  });

  it("keeps a failure first when nothing ran before it", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={message(structuredFailureNewCli())} />
      </ChakraProvider>,
    );

    const transcript = screen.getByLabelText("Langy activity");
    const alert = screen.getByRole("alert");
    expect([...transcript.children][0]?.contains(alert)).toBe(true);
  });

  it("names the transcript to assistive tech as a running log", () => {
    // `getByLabelText` resolves `aria-label` on ANY element, so it passed
    // happily while the label sat on a plain div — where `aria-label` is
    // prohibited (implicit role `generic`) and is therefore dropped. Screen
    // readers got neither the region's name nor its updates, so the running
    // indicator and the red failure card below were both silent. Asking BY ROLE
    // is the only query that can tell the difference.
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyToolActivity message={message(structuredFailureNewCli())} />
      </ChakraProvider>,
    );

    expect(screen.getByRole("log", { name: "Langy activity" })).toBeTruthy();
  });

  // A step that WORKED must never be reported as broken. The failure markers
  // used to be matched anywhere in the payload, so a successful `bash` whose
  // stdout merely quoted one — a grep for the phrase, a tailed log, a test
  // summary — drew a red card AND vanished from the completed receipt.
  describe("given a command that succeeded while printing a failure phrase", () => {
    const grepForThePhrase = {
      id: "assistant-grep",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-grep",
          state: "output-available",
          input: { command: 'grep -rn "failed to" src/' },
          output:
            'src/server/queue.ts:44:    throw new Error("failed to connect");',
        },
      ],
    } as UIMessage;

    // The classification itself belongs to the readers, and is pinned there
    // (langyActivityReaders.unit.test.ts, "given a command that SUCCEEDED but
    // printed a failure phrase"). What this file owns is what the reader SEES.
    it("renders no error card for it", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={grepForThePhrase} />
        </ChakraProvider>,
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the step in the completed receipt", () => {
      // The other half of the same defect, and the half an absence assertion
      // cannot see: a misclassified call did not merely gain a red card, it
      // also DROPPED OUT of the receipt. Pinning only "no alert" would pass for
      // a reader that rendered nothing at all, so the step has to be visibly
      // accounted for as one that ran and finished.
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={grepForThePhrase} />
        </ChakraProvider>,
      );

      expect(
        screen.getByRole("button", { name: /1 action completed/i }),
      ).toBeTruthy();
    });
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
