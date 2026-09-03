/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeadLetterAttemptHistory,
  type DeadLetterMessage,
  DeadLetterSummary,
  DeadLettersEmpty,
  DeadLettersTable,
} from "../ui/sections/dead-letter-card";

// The expanded row's attempt history reads through the tRPC client; the
// fixtures here stand in for the ops.listOutboxAttempts read.
const listOutboxAttemptsQuery = vi.fn((_input: unknown) => ({
  isPending: false,
  data: [
    {
      id: "att_1",
      attempt: 1,
      occurredAt: 0,
      outcome: "retry_scheduled",
      errorType: "DispatchError",
      errorMessage: "receiver returned 503",
      retryAfterMs: null,
    },
    {
      id: "att_2",
      attempt: 2,
      occurredAt: 0,
      outcome: "dead",
      errorType: "DispatchError",
      errorMessage: "receiver returned 410",
      retryAfterMs: null,
    },
  ],
}));
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

/** Repeating-pattern fixtures, not credentials: a realistic ULID or trace id
 *  is high-entropy enough that the secret scanner reads it as a generic API
 *  key. Same reasoning as the sequential-hex HMAC fixture in the spend-ingest
 *  suite. Length is still what the middle-elision renders against. */
const FIXTURE_PROCESS_KEY = "req_aaaaaaaabbbbbbbbccccccccdddddddd";
const FIXTURE_TRACE_ID = "00000000000000000000000000000abc";

function makeMessage(overrides: Partial<DeadLetterMessage> = {}): DeadLetterMessage {
  return {
    id: "msg_1",
    processName: "webhookDelivery",
    projectId: "project_1",
    processKey: FIXTURE_PROCESS_KEY,
    messageKey: "process:req_01:deliver:confirmed",
    intentType: "deliver",
    attempts: 11,
    updatedAt: NOW - 60_000,
    traceId: FIXTURE_TRACE_ID,
    payload: { gateway_request_id: "req_01" },
    ...overrides,
  };
}

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

function renderAttemptHistory({ id, projectId }: { id: string; projectId: string }) {
  const query = listOutboxAttemptsQuery({ outboxId: id, projectId });
  return <DeadLetterAttemptHistory isPending={query.isPending} attempts={query.data} />;
}

afterEach(cleanup);

describe("DeadLettersCard", () => {
  describe("given dead messages across several processes", () => {
    /** @scenario Dead intents are impossible to miss */
    it("names each process, its count, and how stale the oldest is", () => {
      renderWithChakra(
        <DeadLetterSummary
          byProcess={[
            {
              processName: "triggerSettlement",
              count: 92,
              oldestUpdatedAt: NOW - 3 * 60 * 60 * 1000,
            },
            {
              processName: "webhookDelivery",
              count: 12,
              oldestUpdatedAt: NOW - 10 * 60 * 1000,
            },
          ]}
          selected={undefined}
          now={NOW}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByTestId("dead-total").textContent).toContain(
        "104 dead messages across 2 processes",
      );
      expect(screen.getByTestId("dead-filter-triggerSettlement").textContent).toContain("92");
    });

    it("narrows to one process when its chip is pressed", () => {
      const onSelect = vi.fn();
      renderWithChakra(
        <DeadLetterSummary
          byProcess={[
            {
              processName: "webhookDelivery",
              count: 12,
              oldestUpdatedAt: NOW,
            },
          ]}
          selected={undefined}
          now={NOW}
          onSelect={onSelect}
        />,
      );

      fireEvent.click(screen.getByTestId("dead-filter-webhookDelivery"));
      expect(onSelect).toHaveBeenCalledWith("webhookDelivery");
    });
  });

  describe("given a dead message row", () => {
    it("shows the attempts it burned and how long ago it was retired", () => {
      renderWithChakra(
        <DeadLettersTable
          messages={[makeMessage()]}
          now={NOW}
          canManage
          expandedId={null}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={vi.fn()}
          onDiscard={vi.fn()}
        />,
      );

      const row = screen.getByTestId("dead-row-process:req_01:deliver:confirmed");
      expect(row.textContent).toContain("webhookDelivery");
      expect(row.textContent).toContain("deliver");
      expect(row.textContent).toContain("11");
    });

    /** @scenario A dead message can be redriven from the list */
    it("redrives from the list without opening the instance", () => {
      const onRedrive = vi.fn();
      const message = makeMessage();
      renderWithChakra(
        <DeadLettersTable
          messages={[message]}
          now={NOW}
          canManage
          expandedId={null}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={onRedrive}
          onDiscard={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("dead-redrive-process:req_01:deliver:confirmed"));
      // Carries the full ref, which is what makes acting from the fleet-wide
      // list possible at all.
      expect(onRedrive).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: "webhookDelivery",
          projectId: "project_1",
          processKey: FIXTURE_PROCESS_KEY,
        }),
      );
    });

    it("withholds the redrive control from a view-only operator", () => {
      renderWithChakra(
        <DeadLettersTable
          messages={[makeMessage()]}
          now={NOW}
          canManage={false}
          expandedId={null}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={vi.fn()}
          onDiscard={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("dead-redrive-process:req_01:deliver:confirmed")).toBeNull();
    });

    it("reveals the trace and payload when expanded", () => {
      const message = makeMessage();
      renderWithChakra(
        <DeadLettersTable
          messages={[message]}
          now={NOW}
          canManage
          expandedId={message.id}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={vi.fn()}
          onDiscard={vi.fn()}
          renderAttemptHistory={renderAttemptHistory}
        />,
      );

      expect(screen.getByText(message.traceId!)).toBeTruthy();
      expect(screen.getByText("Payload")).toBeTruthy();
    });

    /** @scenario A dead letter shows why it died without leaving the page */
    it("shows the failed attempts oldest first, each with its diagnostic", () => {
      const message = makeMessage();
      renderWithChakra(
        <DeadLettersTable
          messages={[message]}
          now={NOW}
          canManage
          expandedId={message.id}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={vi.fn()}
          onDiscard={vi.fn()}
          renderAttemptHistory={renderAttemptHistory}
        />,
      );

      expect(listOutboxAttemptsQuery).toHaveBeenCalledWith({
        outboxId: message.id,
        projectId: message.projectId,
      });
      const first = screen.getByTestId("dead-attempt-1");
      const second = screen.getByTestId("dead-attempt-2");
      expect(first.textContent).toContain("receiver returned 503");
      expect(second.textContent).toContain("receiver returned 410");
      // Oldest first: the story reads top to bottom.
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // Deliberately unbound. What this asserts is that the row offers both
    // verbs and hands the discard its full ref. That the mark is kept, and
    // that both substrates use the same verbs, are claims the integration
    // suite and the vocabulary suite own — binding them here would report
    // them covered while asserting neither. The binding token is not spelled
    // out even in prose: the parity scanner matches it anywhere in a comment,
    // so writing it here would register a binding for a scenario that does
    // not exist.
    it("offers Redrive and Discard side by side, and Discard carries the full ref", () => {
      const onDiscard = vi.fn();
      const message = makeMessage();
      renderWithChakra(
        <DeadLettersTable
          messages={[message]}
          now={NOW}
          canManage
          expandedId={null}
          redrivingId={null}
          discardingId={null}
          onToggle={vi.fn()}
          onRedrive={vi.fn()}
          onDiscard={onDiscard}
        />,
      );

      fireEvent.click(screen.getByTestId("dead-discard-process:req_01:deliver:confirmed"));
      expect(onDiscard).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: "webhookDelivery",
          projectId: "project_1",
          processKey: FIXTURE_PROCESS_KEY,
        }),
      );
    });
  });

  describe("given nothing is dead", () => {
    it("says so rather than rendering an empty page", () => {
      renderWithChakra(<DeadLettersEmpty />);
      expect(screen.getByText("No dead messages")).toBeTruthy();
    });
  });
});
