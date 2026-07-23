/**
 * @vitest-environment jsdom
 *
 * Covers what an operator is told about a payload's references and who may act
 * on it — the row half of the payload-store scenarios in
 * specs/event-sourcing/payload-store-content-addressed.feature.
 */
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

import { BlobRow } from "../BlobRow";

const blob = (overrides: Partial<OpsBlobSummary> = {}): OpsBlobSummary => ({
  queueName: "trace-processing",
  projectId: "project_abc",
  hash: "b1946ac92492d2347c6235b4d2611184",
  sizeBytes: 4096,
  ttlSeconds: 3600,
  liveLeases: 0,
  holderTokens: 0,
  earliestLeaseDeadlineMs: null,
  sweepOutcome: "reclaimed",
  ...overrides,
});

const renderRow = ({
  summary = blob(),
  canManage = true,
  onDelete = vi.fn(),
}: {
  summary?: OpsBlobSummary;
  canManage?: boolean;
  onDelete?: (blob: OpsBlobSummary) => void;
} = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Table.Root>
        <Table.Body>
          <BlobRow
            blob={summary}
            canManage={canManage}
            onDelete={onDelete}
          />
        </Table.Body>
      </Table.Root>
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("BlobRow", () => {
  describe("given nothing references the payload", () => {
    describe("when the row renders", () => {
      it("says nothing holds it rather than showing a job count", () => {
        renderRow({ summary: blob({ liveLeases: 0 }) });
        expect(screen.getByText("Nothing")).toBeDefined();
      });
    });
  });

  describe("given a single job references the payload", () => {
    describe("when the row renders", () => {
      it("counts the holder in the singular", () => {
        renderRow({ summary: blob({ liveLeases: 1 }) });
        expect(screen.getByText("1 job")).toBeDefined();
      });
    });
  });

  describe("given several jobs reference the payload", () => {
    describe("when the row renders", () => {
      it("counts the holders in the plural", () => {
        renderRow({ summary: blob({ liveLeases: 3 }) });
        expect(screen.getByText("3 jobs")).toBeDefined();
      });
    });
  });

  describe("given a sweep verdict this build does not know", () => {
    describe("when the row renders", () => {
      it("shows an unknown verdict instead of an empty cell", () => {
        renderRow({ summary: blob({ sweepOutcome: "some_new_verdict" }) });
        expect(screen.getByText("Unknown")).toBeDefined();
      });
    });
  });

  describe("given an operator who may not manage the store", () => {
    describe("when the row renders", () => {
      it("offers no destructive action at all", () => {
        const summary = blob();
        renderRow({ summary, canManage: false });
        expect(
          screen.queryByLabelText(`Actions for payload ${summary.hash}`),
        ).toBeNull();
      });
    });
  });

  describe("given an operator who may manage the store", () => {
    describe("when the row renders", () => {
      it("offers the actions menu for that payload", () => {
        const summary = blob();
        renderRow({ summary, canManage: true });
        expect(
          screen.getByLabelText(`Actions for payload ${summary.hash}`),
        ).toBeDefined();
      });
    });
  });
});
