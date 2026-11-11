/**
 * @vitest-environment jsdom
 *
 * A failed step folds into the receipt of the work with the steps that worked, running or
 * answered. It keeps its card only where the reader has to act on it.
 * @see specs/langy/langy-card-taxonomy.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as capabilityRenderer from "../capabilities/langy-capability-renderer.tsx";

let devMode = false;

vi.mock("../../../../../behavior/use-langy-dev-mode.ts", () => ({
  useLangyDevMode: () => [devMode, vi.fn()],
}));

// The Slack card's read of the viewer's connections is mocked at its hook seam, still loading.
vi.mock("../../../behavior/use-langy-automation-data.ts", () => ({
  useLangySlackConnections: () => ({ connections: undefined, canAdd: false, isLoading: true }),
  useLangyAutomationNow: () => ({ fresh: undefined, nextFiring: undefined }),
}));

// The capability card's own rendering is not under test here, only that it stands as a step
// that worked.
vi.mock("../capabilities/langy-capability-renderer.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof capabilityRenderer>()),
  LangyCapabilityRenderer: () => <div data-testid="capability-card" />,
}));

const { useLangyStore } = await import("../../../../../behavior/langy.store.ts");
const { LangyToolActivity } = await import("../langy-tool-activity.tsx");

afterEach(() => {
  devMode = false;
  vi.useRealTimers();
  useLangyStore.setState({ turnPhase: "idle" });
});

function failedStep({
  id,
  command,
  errorText,
}: {
  id: string;
  command: string;
  errorText?: string;
}) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-error",
    input: { command },
    errorText: errorText ?? `cat: ${command.slice(4)}: No such file or directory`,
  } as never;
}

function okCommand({ id, command }: { id: string; command: string }) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: "ok",
  } as never;
}

const okRead = {
  type: "tool-read",
  toolCallId: "read-1",
  state: "output-available",
  input: { filePath: "README.md" },
  output: "# Read me",
} as never;

const runningRead = {
  type: "tool-read",
  toolCallId: "read-2",
  state: "input-available",
  input: { filePath: "CHANGELOG.md" },
} as never;

const datasetCard = {
  type: "tool-langwatch.dataset.list",
  toolCallId: "dataset-1",
  state: "output-available",
  input: { command: "langwatch dataset list" },
  output: JSON.stringify({ data: [], pagination: { total: 0 } }),
} as never;

const deniedStep = {
  type: "tool-bash",
  toolCallId: "call-denied",
  state: "output-denied",
  input: { command: "rm -rf build" },
} as never;

const reply = {
  type: "text",
  text: "Opened pull request #1 with the tracing changes.",
} as never;

const failA = failedStep({ id: "fail-a", command: "cat a.txt" });
const failB = failedStep({ id: "fail-b", command: "cat b.txt" });
const failC = failedStep({ id: "fail-c", command: "cat c.txt" });
const ls = okCommand({ id: "ls-1", command: "ls modules" });

type ActivityProps = {
  parts: UIMessage["parts"];
  live: boolean;
  interrupted?: boolean;
  endsTheTurn?: boolean;
};

function activity({
  parts,
  live,
  interrupted = false,
  endsTheTurn = true,
}: ActivityProps): ReactNode {
  const message: UIMessage = { id: "assistant-1", role: "assistant", parts };
  return (
    <DesignSystemProvider forcedTheme="light">
      <LangyToolActivity
        message={message}
        live={live}
        interrupted={interrupted}
        endsTheTurn={endsTheTurn}
      />
    </DesignSystemProvider>
  );
}

function renderActivity(props: ActivityProps) {
  return render(activity(props));
}

/** The receipt's summary line: the one disclosure that names the work. */
function receiptHeader(): HTMLElement {
  return screen.getByRole("button", { name: /^\d+ actions? (completed|failed)/ });
}

/** The receipt's rows, scoped so the header never matches a row query. */
function receiptSteps() {
  return within(screen.getByRole("list", { name: "Finished steps" }));
}

describe("a failed step", () => {
  describe("given the turn answered after the failure", () => {
    /** @scenario "A failed step folds into the record of the work" */
    it("folds the failure into the receipt rather than a card", () => {
      const { container } = renderActivity({ parts: [failA, reply], live: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("1 action failed");
      expect(container.textContent).not.toContain("This step couldn't be completed.");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("reads like a step that worked, tagged failed, never that Langy carried on", () => {
      const { container } = renderActivity({ parts: [failA, reply], live: false });

      const row = receiptSteps().getByRole("button", { name: /failed/ });
      expect(row.textContent).toContain("Ran a command");
      expect(row.textContent).toContain("failed");
      expect(row.textContent).toContain("cat a.txt");
      expect(container.textContent).not.toContain("carried on");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("opens into the command and its error text, with no alert", async () => {
      const user = userEvent.setup();
      const { container } = renderActivity({ parts: [failA, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent).toContain("$ cat a.txt");
      expect(container.textContent).toContain("No such file or directory");
      expect(screen.queryByRole("alert")).toBeNull();
      // The raw block already carries the error line, so the generic copy is not said again.
      expect(container.textContent).not.toContain("This step couldn't be completed.");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("shows the error's code and its trace and logs links when it has them", async () => {
      const user = userEvent.setup();
      const handled = JSON.stringify({
        ok: false,
        error: {
          code: "internal_error",
          message: "Something broke on our side.",
          httpStatus: 500,
          isHandled: true,
          traceUrl: "https://grafana.example.com/trace/abc",
          logsUrl: "https://grafana.example.com/logs/abc",
        },
      });
      const failure = failedStep({ id: "fail-h", command: "cat h.txt", errorText: handled });
      const { container } = renderActivity({ parts: [failure, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent).toContain("internal_error");
      expect(screen.getByRole("link", { name: "Open debug trace in Grafana" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open related logs in Grafana" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /documentation/ })).toBeNull();
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("says a failure finished as output-available once, not above its own raw text", async () => {
      const user = userEvent.setup();
      const message = "Something broke on our side.";
      const finished = {
        type: "tool-bash",
        toolCallId: "fail-out",
        state: "output-available",
        input: { command: "langwatch trace list" },
        output: JSON.stringify({
          ok: false,
          error: { code: "internal_error", message, httpStatus: 500, isHandled: true },
        }),
      } as never;
      const { container } = renderActivity({ parts: [finished, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent?.split(message).length).toBe(2);
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("shows a coloured error once, without its colour codes", async () => {
      const user = userEvent.setup();
      const failure = failedStep({
        id: "fail-ansi",
        command: "cat x.txt",
        errorText: "\u001b[31mfailed\u001b[0m to open boom",
      });
      const { container } = renderActivity({ parts: [failure, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent?.split("failed to open boom").length).toBe(2);
      expect(container.textContent).not.toContain("\u001b");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("shows a CLI text envelope failure as its text, not as the JSON line", async () => {
      const user = userEvent.setup();
      const finished = {
        type: "tool-bash",
        toolCallId: "fail-env",
        state: "output-available",
        input: { command: "langwatch trace list" },
        output: JSON.stringify({
          kind: "text",
          text: "✖ failed to list traces: request timed out",
        }),
      } as never;
      const { container } = renderActivity({ parts: [finished, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent).not.toContain('{"kind"');
      expect(container.textContent?.split("failed to list traces").length).toBe(2);
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("folds a CLI text envelope that opens with an Error line as a failed step", async () => {
      const user = userEvent.setup();
      const finished = {
        type: "tool-bash",
        toolCallId: "fail-text",
        state: "output-available",
        input: { command: "langwatch trace list" },
        output: JSON.stringify({
          kind: "text",
          text: "Error: dataset not found.",
        }),
      } as never;
      const { container } = renderActivity({ parts: [finished, reply], live: false });

      expect(receiptHeader().textContent).toContain("1 action failed");
      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(container.textContent).toContain("dataset not found");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("keeps a CLI text envelope that only mentions error mid-line as completed", () => {
      const finished = {
        type: "tool-bash",
        toolCallId: "ok-error-word",
        state: "output-available",
        input: { command: "langwatch trace list" },
        output: JSON.stringify({ kind: "text", text: "0 error: none found" }),
      } as never;
      renderActivity({ parts: [finished, reply], live: false });

      expect(receiptHeader().textContent).toContain("1 action completed");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("keeps a successful CLI read with an indented Error field label as completed", () => {
      const finished = {
        type: "tool-bash",
        toolCallId: "ok-error-field",
        state: "output-available",
        input: { command: "langwatch simulation-run get abc" },
        output: JSON.stringify({
          kind: "text",
          text: "Run abc\n    Error:    judge timed out",
        }),
      } as never;
      renderActivity({ parts: [finished, reply], live: false });

      expect(receiptHeader().textContent).toContain("1 action completed");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("opens its raw payload in developer mode", async () => {
      devMode = true;
      const user = userEvent.setup();
      const { container } = renderActivity({ parts: [failA, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: "Show raw data" }));

      expect(container.textContent).toContain('"state": "output-error"');
    });
  });

  describe("given the reply is a later run of the turn", () => {
    /** @scenario "A failed step folds into the record of the work" */
    it("folds the failure the run cannot see the reply from", () => {
      // MessageContent splits a turn into runs, so an activity run holds only
      // its own parts and cannot see what came after it. The caller says so.
      renderActivity({ parts: [failA], live: false, endsTheTurn: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("1 action failed");
    });
  });

  describe("given the turn is still running", () => {
    /** @scenario "A step that fails while the turn is running folds into the record too" */
    it("holds the newest failure in view as one quiet line, not a card", () => {
      const { container } = renderActivity({ parts: [ls, failA], live: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().queryByText("cat a.txt")).toBeNull();
      expect(container.textContent).toContain("cat a.txt");
      expect(receiptHeader().textContent).toContain("2 tool calls, 1 failed");
    });

    /** @scenario "A step that fails while the turn is running folds into the record too" */
    it("folds the failure into the receipt once the next step starts", () => {
      const { rerender } = renderActivity({ parts: [ls, failA], live: true });

      rerender(activity({ parts: [ls, failA, runningRead], live: true }));

      expect(receiptSteps().getByText("cat a.txt")).toBeTruthy();
      expect(receiptHeader().textContent).toContain("2 tool calls, 1 failed");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("given steps that worked and steps that failed", () => {
    const mixed = [okRead, failA, ls, failB, failC, reply] as UIMessage["parts"];

    /** @scenario "The record of the work counts its failures quietly" */
    it("counts the failures beside the calls in the header", () => {
      renderActivity({ parts: mixed, live: false });

      expect(receiptHeader().textContent).toContain("2 actions completed");
      expect(receiptHeader().textContent).toContain("5 tool calls, 3 failed");
    });

    /** @scenario "The record of the work counts its failures quietly" */
    it("lists every step in the order it ran", () => {
      renderActivity({ parts: mixed, live: false });

      const rows = receiptSteps()
        .getAllByRole("listitem")
        .map((row) => row.textContent ?? "");
      expect(rows.map((row) => /failed/.test(row))).toEqual([false, true, false, true, true]);
      expect(rows[1]).toContain("cat a.txt");
      expect(rows[2]).toContain("ls modules");
    });
  });

  describe("given every step failed", () => {
    /** @scenario "The record of the work counts its failures quietly" */
    it("says how many actions failed and nothing on the right", () => {
      renderActivity({ parts: [failA, failB, failC, reply], live: false });

      expect(receiptHeader().textContent).toContain("3 actions failed");
      expect(receiptHeader().textContent).not.toContain("tool call");
    });
  });

  describe("given a failed step beside a capability card that worked", () => {
    /** @scenario "The record of the work counts its failures quietly" */
    it("does not read as all failed", () => {
      renderActivity({ parts: [failA, datasetCard, reply], live: false });

      expect(screen.getByTestId("capability-card")).toBeTruthy();
      const header = screen.getByRole("button", { name: /\d+ actions? completed/ });
      expect(header.textContent).toContain("1 action completed");
      expect(header.textContent).toContain("2 tool calls, 1 failed");
      expect(screen.queryByRole("button", { name: /^\d+ actions? failed/ })).toBeNull();
    });
  });

  describe("given a failed step beside a step still running", () => {
    /** @scenario "A step that fails while the turn is running folds into the record too" */
    it("does not read as all failed while the next step runs", () => {
      renderActivity({ parts: [failA, runningRead], live: true });

      const header = screen.getByRole("button", { name: /Working/ });
      expect(header.textContent).not.toMatch(/actions? failed/);
      expect(header.textContent).toContain("1 tool call, 1 failed");
    });
  });

  describe("given a stopped turn with a failed step and a step that never finished", () => {
    /** @scenario "A stopped turn keeps its failures folded while it is the latest turn" */
    it("titles the receipt by the failure, not as still working", () => {
      renderActivity({ parts: [failA, runningRead], live: false, interrupted: true });

      expect(receiptHeader().textContent).toContain("1 action failed");
      expect(screen.queryByRole("button", { name: /Working/ })).toBeNull();
    });

    /** @scenario "A stopped turn keeps its failures folded while it is the latest turn" */
    it("titles the receipt by the failure when the stopped turn is still streaming", () => {
      renderActivity({ parts: [failA, runningRead], live: true, interrupted: true });

      expect(receiptHeader().textContent).toContain("1 action failed");
      expect(screen.queryByRole("button", { name: /Working/ })).toBeNull();
    });

    /** @scenario "A stopped turn keeps its failures folded while it is the latest turn" */
    it("folds the failure into the receipt when the turn is stopped while still streaming", () => {
      renderActivity({ parts: [failA], live: true, interrupted: true });

      expect(receiptSteps().getByText("cat a.txt")).toBeTruthy();
      expect(receiptHeader().textContent).toContain("1 action failed");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("given a reloaded turn, not stopped, that ends on a step that never finished", () => {
    it("titles the receipt by the failure when a reload ends the turn on an unfinished step", () => {
      renderActivity({ parts: [failA, runningRead], live: false, interrupted: false });

      expect(receiptHeader().textContent).toContain("1 action failed");
      expect(screen.queryByRole("button", { name: /Working/ })).toBeNull();
    });
  });

  describe("given the turn ended on a failure with no reply after it", () => {
    /** @scenario "Only the last failed step of an unanswered turn keeps its card" */
    it("keeps the card for the step the turn ended on", () => {
      renderActivity({ parts: [ls, failB], live: false });

      expect(screen.getByRole("alert").textContent).toContain("b.txt");
    });

    /** @scenario "Only the last failed step of an unanswered turn keeps its card" */
    it("folds a failure that steps which worked came after", () => {
      renderActivity({ parts: [failA, ls], live: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("cat a.txt")).toBeTruthy();
    });

    /** @scenario "Only the last failed step of an unanswered turn keeps its card" */
    it("pops out only the last failure when the running turn settles", () => {
      const parts = [failA, ls, failB] as UIMessage["parts"];
      const { rerender } = renderActivity({ parts, live: true });
      expect(screen.queryByRole("alert")).toBeNull();

      rerender(activity({ parts, live: false }));

      const cards = screen.getAllByRole("alert");
      expect(cards).toHaveLength(1);
      expect(cards[0]!.textContent).toContain("b.txt");
      expect(receiptSteps().getByText("cat a.txt")).toBeTruthy();
    });
  });

  describe("given the reader stopped the turn right after a failure", () => {
    /** @scenario "A stopped turn keeps its failures folded while it is the latest turn" */
    it("keeps the failure folded", () => {
      renderActivity({ parts: [ls, failB], live: false, interrupted: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("cat b.txt")).toBeTruthy();
    });
  });

  describe("given a failure no retry can fix", () => {
    const notConnected = failedStep({
      id: "gh-1",
      command: "gh pr list",
      errorText: "To get started with GitHub CLI, please run:  gh auth login",
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps the card while the turn runs", () => {
      renderActivity({ parts: [notConnected], live: true });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps the card after the turn answered", () => {
      renderActivity({ parts: [notConnected, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  describe("given a step refused for lack of access", () => {
    const forbidden = failedStep({
      id: "forbidden-1",
      command: "cat secret.txt",
      errorText: JSON.stringify({
        ok: false,
        error: {
          code: "permission_denied",
          message: "You do not have access to this project.",
          httpStatus: 403,
          isHandled: true,
        },
      }),
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps the card while the turn runs", () => {
      renderActivity({ parts: [forbidden], live: true });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps the card after the turn answered", () => {
      renderActivity({ parts: [forbidden, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  describe("given the sandbox's own credential failed", () => {
    const unauthorized = failedStep({
      id: "unauthorized-1",
      command: "langwatch trace list",
      errorText: JSON.stringify({
        ok: false,
        error: {
          code: "unauthorized",
          message: "Invalid API key.",
          httpStatus: 401,
          isHandled: true,
        },
      }),
    });

    /** @scenario "A sandbox credential failure folds into the record" */
    it("folds into the receipt after the turn answered", () => {
      renderActivity({ parts: [unauthorized, reply, ls], live: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("langwatch trace list")).toBeTruthy();
    });

    /** @scenario "A sandbox credential failure folds into the record" */
    it("folds into the receipt while the turn runs", () => {
      renderActivity({ parts: [unauthorized, ls], live: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("langwatch trace list")).toBeTruthy();
    });

    /** @scenario "A sandbox credential failure folds into the record" */
    it("says, once opened, that the failure is on Langy's side", async () => {
      const user = userEvent.setup();
      renderActivity({ parts: [unauthorized, reply], live: false });

      await user.click(receiptSteps().getByRole("button", { name: /failed/ }));

      expect(screen.getByText(/on our side/)).toBeTruthy();
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps its card when a local tool failed on the reader's own login", () => {
      const localUnauthorized = {
        ...(unauthorized as Record<string, unknown>),
        type: "tool-local_bash",
        toolCallId: "local-unauthorized-1",
      } as never;
      renderActivity({ parts: [localUnauthorized, reply, ls], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  describe("given a local tool that is not logged in", () => {
    const notAuthenticated = {
      type: "tool-local_bash",
      toolCallId: "local-login-1",
      state: "output-error",
      input: { command: "langwatch trace list" },
      errorText: JSON.stringify({
        ok: false,
        error: { code: "not_authenticated", message: "Not logged in.", isHandled: true },
      }),
    } as never;

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps its card although the failure carried no HTTP status", () => {
      renderActivity({ parts: [notAuthenticated, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it("keeps its card while the turn runs", () => {
      renderActivity({ parts: [notAuthenticated], live: true });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A failure no retry can fix keeps its card" */
    it.each(["missing_api_key", "unauthorized", "not_authenticated"])(
      "keeps its card for the %s credential code",
      (code) => {
        const failure = {
          ...(notAuthenticated as Record<string, unknown>),
          toolCallId: `local-${code}`,
          errorText: JSON.stringify({
            ok: false,
            error: { code, message: "Login needed.", isHandled: true },
          }),
        } as never;
        renderActivity({ parts: [failure, reply], live: false });

        expect(screen.getByRole("alert")).toBeTruthy();
      },
    );
  });

  describe("given a step refused with an access-denial code that is not marked final", () => {
    const denied = failedStep({
      id: "denied-1",
      command: "langwatch scenario create",
      errorText: JSON.stringify({
        ok: false,
        error: {
          code: "api_key_permission_denied",
          message: "API Key does not grant required permission: scenarios:manage",
          isHandled: false,
        },
      }),
    });

    /** @scenario "A refused access keeps its card even when a retry might work" */
    it("keeps its card after the turn answered", () => {
      renderActivity({ parts: [denied, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  describe("given a probe for something that does not exist", () => {
    const notFound = failedStep({
      id: "missing-1",
      command: "cat missing.txt",
      errorText: JSON.stringify({
        ok: false,
        error: {
          code: "dataset_not_found",
          message: "No dataset with that slug.",
          httpStatus: 404,
          isHandled: true,
        },
      }),
    });

    /** @scenario "A not-found probe folds into the record" */
    it("folds into the receipt while the turn runs", () => {
      renderActivity({ parts: [notFound, ls], live: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("cat missing.txt")).toBeTruthy();
    });

    /** @scenario "A not-found probe folds into the record" */
    it("folds into the receipt after the turn answered", () => {
      renderActivity({ parts: [notFound, reply], live: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptSteps().getByText("cat missing.txt")).toBeTruthy();
    });
  });

  describe("given the person denied the step", () => {
    /** @scenario "A step the person denied keeps its card" */
    it("keeps the card while the turn runs", () => {
      renderActivity({ parts: [deniedStep], live: true });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A step the person denied keeps its card" */
    it("keeps the card after the turn answered", () => {
      renderActivity({ parts: [deniedStep, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  describe("given a Slack automation refused for naming no connection", () => {
    const slackRefusal = failedStep({
      id: "slack-1",
      command:
        'langwatch trigger create "Errors" --action SEND_SLACK_MESSAGE --slack-channel "#support-alerts" --format json',
      errorText: "No Slack connection was named.",
    });

    /** @scenario "A failure the person can act on keeps its card" */
    it("keeps the connection card while the turn runs", () => {
      renderActivity({ parts: [slackRefusal], live: true });

      expect(screen.getByTestId("langy-slack-connection-card")).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Finished steps" })).toBeNull();
    });

    /** @scenario "A failure the person can act on keeps its card" */
    it("keeps the connection card after the turn answered", () => {
      renderActivity({ parts: [slackRefusal, reply], live: false });

      expect(screen.getByTestId("langy-slack-connection-card")).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Finished steps" })).toBeNull();
    });
  });
});

describe("the receipt of the work", () => {
  const opened = () => receiptHeader().getAttribute("aria-expanded");
  const pass = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  let wrapper: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    renderActivity({ parts: [ls, reply], live: false });
    wrapper = receiptHeader().parentElement!;
  });

  /** @scenario "A receipt the reader only passes over still closes" */
  it("closes after a pointer only passed over it", () => {
    fireEvent.pointerEnter(wrapper);
    pass(5000);
    expect(opened()).toBe("true");

    fireEvent.pointerLeave(wrapper);
    pass(2200);
    expect(opened()).toBe("false");
  });

  /** @scenario "A receipt the reader only passes over still closes" */
  it("stays open once the reader clicked into it", () => {
    fireEvent.click(receiptSteps().getAllByRole("button")[0]!);
    fireEvent.pointerLeave(wrapper);
    pass(5000);

    expect(opened()).toBe("true");
  });

  /** @scenario "A receipt the reader only passes over still closes" */
  it("stays open once the reader focused into it", () => {
    fireEvent.focusIn(receiptHeader());
    fireEvent.pointerLeave(wrapper);
    pass(5000);

    expect(opened()).toBe("true");
  });

  /** @scenario "A receipt the reader only passes over still closes" */
  it("does not close while a pointer that left came back", () => {
    fireEvent.pointerEnter(wrapper);
    fireEvent.pointerLeave(wrapper);
    pass(1000);
    fireEvent.pointerEnter(wrapper);
    pass(5000);
    expect(opened()).toBe("true");

    fireEvent.pointerLeave(wrapper);
    pass(2200);
    expect(opened()).toBe("false");
  });
});

describe("the receipt header while the turn runs", () => {
  beforeEach(() => {
    useLangyStore.setState({ turnPhase: "active" });
  });

  /** @scenario "The record of the work counts its failures quietly" */
  it("does not call the receipt all failed while the step that worked stands beside it", () => {
    renderActivity({ parts: [failA, ls], live: true });

    expect(receiptHeader().textContent).toMatch(/^1 action completed/);
  });

  /** @scenario "The record of the work counts its failures quietly" */
  it("still calls a receipt of only failures all failed, counting the one beside it", () => {
    renderActivity({ parts: [failA, failB], live: true });

    expect(receiptHeader().textContent).toMatch(/^2 actions failed/);
  });
});
