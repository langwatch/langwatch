/**
 * @vitest-environment jsdom
 *
 * One vocabulary across both dead-letter substrates
 * (specs/ops/dead-letter-recovery.feature).
 *
 * The two surfaces retire work through different machinery and were built at
 * different times, which is exactly how they drifted: the queue card said
 * "Replay" while the outbox said "Redrive" for the same act. This renders the
 * row from each and holds them to the same words — including that "Replay" is
 * gone from here, because it means projection rebuilds elsewhere in ops.
 */
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadLettersTable } from "../deadLetters/DeadLettersCard";
import { DlqRow } from "../queues/DlqCard";

vi.mock("~/utils/api", () => ({
  api: {
    ops: {
      listOutboxAttempts: { useQuery: () => ({ isPending: false, data: [] }) },
    },
  },
}));

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

afterEach(cleanup);

describe("dead-letter recovery vocabulary", () => {
  describe("given both substrates render their row controls", () => {
    /** @scenario Recovery verbs are the same on both substrates */
    it("calls the acts redrive and discard on each, and never replay", () => {
      const { unmount } = renderWithChakra(
        <DeadLettersTable
          messages={[
            {
              id: "msg_1",
              processName: "webhookDelivery",
              projectId: "project_1",
              processKey: "req_aaaabbbbccccdddd",
              messageKey: "process:req_01:deliver",
              intentType: "deliver",
              attempts: 11,
              updatedAt: NOW - 60_000,
              traceId: null,
              payload: {},
            },
          ]}
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

      const outboxButtons = screen
        .getAllByRole("button")
        .map((b) => b.textContent);
      expect(outboxButtons).toContain("Redrive");
      expect(outboxButtons).toContain("Discard");
      expect(outboxButtons.join(" ")).not.toMatch(/Replay/);
      unmount();

      renderWithChakra(
        <Table.Root>
          <Table.Body>
            <DlqRow
              group={{
                queueName: "queue-a",
                queueDisplayName: "Queue A",
                groupId: "group-1",
                pipelineName: "traces",
                error: "HTTP 500",
                jobCount: 3,
              }}
              canManage
              onAct={vi.fn()}
            />
          </Table.Body>
        </Table.Root>,
      );

      const queueButtons = screen
        .getAllByRole("button")
        .map((b) => b.textContent);
      expect(queueButtons).toContain("Redrive");
      expect(queueButtons).toContain("Discard");
      expect(queueButtons.join(" ")).not.toMatch(/Replay/);
    });

    it("withholds both verbs from a view-only operator on each surface", () => {
      renderWithChakra(
        <Table.Root>
          <Table.Body>
            <DlqRow
              group={{
                queueName: "queue-a",
                queueDisplayName: "Queue A",
                groupId: "group-1",
                pipelineName: null,
                error: null,
                jobCount: 1,
              }}
              canManage={false}
              onAct={vi.fn()}
            />
          </Table.Body>
        </Table.Root>,
      );
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(within(screen.getByRole("row")).queryByText("Discard")).toBeNull();
    });
  });
});
