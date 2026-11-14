import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  type AggregateDiscoveryAnswer,
  type AggregateSearchAnswer,
  type AggregateSearchRequested,
  OpsSearchQueryRequiredError,
} from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import type { OpsEventExplorer } from "../app/ops.app.ts";
import type {
  OpsEventLogSearchRecord,
  OpsEventLogSearchResultsRepository,
} from "../repositories/ops-event-log-search-results.repository.ts";

const logger = createLogger("langwatch:ops:event-log-search");

type EventLogSearchSender = {
  send(input: { requestId: string; tenantId: string; occurredAt: number }): Promise<unknown>;
};

export type EventLogSearchCommands = {
  requestEventLogSearch: EventLogSearchSender;
  recordEventLogSearchCompleted: EventLogSearchSender;
};

/**
 * The event-log search in two halves (ADR-202 Decided 14): the api stores an accepted search and
 * sends its command; the worker reads every tenant on its own identity, stores the matches and
 * records the completion the screen's read is refetched on.
 */
export class OpsEventLogSearchService {
  #commands: EventLogSearchCommands | undefined;

  static create({
    explorer,
    results,
    newRequestId = () => generate("ops").toString(),
  }: {
    explorer: Pick<OpsEventExplorer, "searchAggregates" | "discoverAggregates">;
    results: OpsEventLogSearchResultsRepository;
    newRequestId?: () => string;
  }): OpsEventLogSearchService {
    return new OpsEventLogSearchService(explorer, results, newRequestId);
  }

  private constructor(
    private readonly explorer: Pick<OpsEventExplorer, "searchAggregates" | "discoverAggregates">,
    private readonly results: OpsEventLogSearchResultsRepository,
    private readonly newRequestId: () => string,
  ) {}

  connect(commands: EventLogSearchCommands): void {
    this.#commands = commands;
  }

  /** Stores the search pending and hands it to a worker under the operator's own tenant. */
  async request({
    query,
    tenantIds,
    sinceMs,
    requestedBy,
  }: {
    query: string;
    tenantIds: string[];
    sinceMs: number;
    requestedBy: string;
  }): Promise<AggregateSearchRequested> {
    // Unbounded by tenant and query, the worker's read would scan the whole event log.
    if (tenantIds.length === 0 && query.trim().length === 0) {
      throw new OpsSearchQueryRequiredError();
    }
    const commands = this.#requireConnected();
    const requestId = this.newRequestId();
    await this.results.save({
      requestId,
      record: { status: "pending", query, tenantIds, sinceMs },
    });
    await commands.requestEventLogSearch.send({
      requestId,
      tenantId: requestedBy,
      occurredAt: nowInstant().epochMilliseconds,
    });
    return { requestId };
  }

  /** The replay wizard's aggregate count, stored pending and handed to the same worker. */
  async requestDiscovery({
    projectionNames,
    since,
    tenantIds,
    requestedBy,
  }: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    requestedBy: string;
  }): Promise<AggregateSearchRequested> {
    const commands = this.#requireConnected();
    const requestId = this.newRequestId();
    await this.results.save({
      requestId,
      record: { status: "pending", read: "discovery", projectionNames, since, tenantIds },
    });
    await commands.requestEventLogSearch.send({
      requestId,
      tenantId: requestedBy,
      occurredAt: nowInstant().epochMilliseconds,
    });
    return { requestId };
  }

  /** The worker's half: an answered search is not read again, and its completion is resent. */
  async run({ requestId, tenantId }: { requestId: string; tenantId: string }): Promise<void> {
    const commands = this.#requireConnected();
    const [record] = await this.results.findByRequestId({ requestId });
    if (!record) {
      logger.warn({ requestId }, "ops event-log search expired before a worker ran it");
    } else if (record.status === "pending") {
      await this.#answer({ requestId, record });
    }
    // Sent even when expired, so the screen refetches and reads "expired" rather than waiting.
    await commands.recordEventLogSearchCompleted.send({
      requestId,
      tenantId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  /** The screen's answer for one request id; a count's id is not a search's. */
  async result({ requestId }: { requestId: string }): Promise<AggregateSearchAnswer> {
    const [record] = await this.results.findByRequestId({ requestId });
    if (!record || "read" in record) return { status: "expired" };
    if (record.status === "pending") return { status: "pending" };
    if (record.status === "failed") return { status: "failed" };
    return { status: "done", results: record.results };
  }

  /** The replay wizard's answer for one request id; a search's id is not a count's. */
  async discovery({ requestId }: { requestId: string }): Promise<AggregateDiscoveryAnswer> {
    const [record] = await this.results.findByRequestId({ requestId });
    if (!record) return { status: "expired" };
    if (record.status === "failed") return { status: "failed" };
    if (!("read" in record)) return { status: "expired" };
    if (record.status === "pending") return { status: "pending" };
    return { status: "done", discovery: record.discovery };
  }

  async #answer({
    requestId,
    record,
  }: {
    requestId: string;
    record: Extract<OpsEventLogSearchRecord, { status: "pending" }>;
  }): Promise<void> {
    try {
      await this.results.save({ requestId, record: await this.#read(record) });
    } catch (err) {
      // The engine's own prose names cluster internals; it is logged, never answered.
      logger.warn(
        { requestId, err: err instanceof Error ? err.message : String(err) },
        "ops event-log search failed",
      );
      await this.results.save({ requestId, record: { status: "failed" } });
    }
  }

  /** The one explorer read a pending record names, on the worker's own identity. */
  async #read(
    record: Extract<OpsEventLogSearchRecord, { status: "pending" }>,
  ): Promise<OpsEventLogSearchRecord> {
    if ("read" in record) {
      const discovery = await this.explorer.discoverAggregates({
        projectionNames: record.projectionNames,
        since: record.since,
        tenantIds: record.tenantIds,
      });
      return { status: "done", read: "discovery", discovery };
    }
    const results = await this.explorer.searchAggregates({
      query: record.query,
      tenantIds: record.tenantIds,
      sinceMs: record.sinceMs,
    });
    return { status: "done", results };
  }

  #requireConnected(): EventLogSearchCommands {
    if (!this.#commands) {
      throw new Error("the ops event-log search commands are not connected in this process");
    }
    return this.#commands;
  }
}
