/**
 * The private probe: the empty capability must show the organisation's reader no row, and only a
 * server that cannot serve LangWatchQL at all answers "not provisioned"; any other failure is
 * undecided and surfaces for the gate to refuse.
 * @see specs/lwql/isolation.feature
 */
import {
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
  type LangWatchQLRouter,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLPrivateAccessModelProbeService } from "../langwatch-ql-private-access-model-probe.service.ts";

class StubExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly outcome: () => Promise<LangWatchQLExecutionResult>) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);
    return this.outcome();
  }
}

const resultOf = (rows: Record<string, unknown>[]): LangWatchQLExecutionResult => ({
  columns: [],
  rows,
  statistics: { elapsedMs: 1, rowsRead: rows.length, bytesRead: 0, rowsReturned: rows.length },
});

function probeOver({ outcome }: { outcome: () => Promise<LangWatchQLExecutionResult> }) {
  const executor = new StubExecutor(outcome);
  const router: LangWatchQLRouter = {
    resolveRoute: () => Promise.resolve({ executor }),
    close: () => Promise.resolve(),
  };
  return { executor, probe: LangWatchQLPrivateAccessModelProbeService.create({ router }) };
}

describe("given a private server probed as the organisation's reader", () => {
  /** @scenario "A routed organisation whose server is provisioned is answered on its own server" */
  it("is provisioned when the empty capability shows no row, and sends exactly that capability", async () => {
    const { executor, probe } = probeOver({ outcome: async () => resultOf([]) });

    expect(await probe.probe({ projectIds: ["project-a"] })).toBe("provisioned");
    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]).toMatchObject({ tenantCapability: "", projectIds: [] });
  });

  /** @scenario "An organisation routed to a private ClickHouse that is not provisioned is refused before any SQL runs" */
  it("is not provisioned when the empty capability shows a row", async () => {
    const { probe } = probeOver({ outcome: async () => resultOf([{ visible: 1 }]) });

    expect(await probe.probe({ projectIds: ["project-a"] })).toBe("not_provisioned");
  });

  /** @scenario "An organisation routed to a private ClickHouse that is not provisioned is refused before any SQL runs" */
  it.each([
    ["the reader cannot log in or see traces", () => new LangWatchQLUnavailableError()],
    ["a dataset cannot be read", () => new LangWatchQLProvisioningIncompleteError()],
  ])("is not provisioned when %s", async (_name, failure) => {
    const { probe } = probeOver({ outcome: () => Promise.reject(failure()) });

    expect(await probe.probe({ projectIds: ["project-a"] })).toBe("not_provisioned");
  });

  /** @scenario "A private server that cannot be probed refuses rather than falling back" */
  it("rethrows any other failure, so the gate refuses as undecided", async () => {
    const { probe } = probeOver({ outcome: () => Promise.reject(new Error("socket hang up")) });

    await expect(probe.probe({ projectIds: ["project-a"] })).rejects.toThrow("socket hang up");
  });

  /** @scenario "A private server that cannot be probed refuses rather than falling back" */
  it("rethrows a route that cannot be resolved, never answering for the shared server", async () => {
    const router: LangWatchQLRouter = {
      resolveRoute: () => Promise.reject(new Error("no route")),
      close: () => Promise.resolve(),
    };
    const probe = LangWatchQLPrivateAccessModelProbeService.create({ router });

    await expect(probe.probe({ projectIds: ["project-a"] })).rejects.toThrow("no route");
  });
});
