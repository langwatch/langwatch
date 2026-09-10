import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";
import {
  GraphTriggerSentRepository,
  type AnalyticsMetricSource,
  type OpenGraphTriggerSent,
} from "../graph-trigger-sent.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

export class MemoryGraphTriggerSentRepository extends GraphTriggerSentRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryGraphTriggerSentRepository {
    return new MemoryGraphTriggerSentRepository(memory);
  }

  findProjectsWithGraphTriggers(): Promise<string[]> {
    const projects = new Set<string>();
    for (const trigger of this.memory.triggers.values()) {
      if (trigger.customGraphId !== null && trigger.active && !trigger.deleted) {
        projects.add(trigger.projectId);
      }
    }
    return Promise.resolve([...projects]);
  }

  findProjectsWithOpenGraphTriggerSent(): Promise<Set<string>> {
    return Promise.resolve(
      new Set(this.open().map((incident) => incident.projectId)),
    );
  }

  tryFindGraphTriggerSource(params: {
    triggerId: string;
    customGraphId: string;
    projectId: string;
    seriesName?: string;
  }): Promise<AnalyticsMetricSource | undefined> {
    const incident = this.memory.graphTriggerSent.find(
      (row) =>
        row.triggerId === params.triggerId &&
        row.customGraphId === params.customGraphId &&
        row.projectId === params.projectId,
    );
    return Promise.resolve(incident?.source);
  }

  findOpenTriggerIdsForProject(projectId: string): Promise<Set<string>> {
    return Promise.resolve(
      new Set(
        this.open()
          .filter((incident) => incident.projectId === projectId)
          .map((incident) => incident.triggerId),
      ),
    );
  }

  tryFindOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    const incident = this.open().find((row) => this.matches(row, params));
    return Promise.resolve(incident === undefined ? null : this.asOpen(incident));
  }

  tryFindLatestForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null> {
    const incidents = this.memory.graphTriggerSent.filter((row) => this.matches(row, params));
    const latest = incidents.at(-1);
    return Promise.resolve(latest === undefined ? null : { id: latest.id });
  }

  /**
   * Opens the incident when there is none: the claim is what makes one
   * evaluator the sender, so a second caller finding an open row gets nothing.
   */
  tryClaimOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    if (this.open().some((row) => this.matches(row, params))) return Promise.resolve(null);
    const incident = {
      id: generate("graphtriggersent").toString(),
      triggerId: params.triggerId,
      projectId: params.projectId,
      customGraphId: params.customGraphId,
      source: undefined,
      resolvedAt: null,
    };
    this.memory.graphTriggerSent.push(incident);
    return Promise.resolve(this.asOpen(incident));
  }

  deleteOpenClaim(params: { id: string; projectId: string }): Promise<void> {
    const index = this.memory.graphTriggerSent.findIndex(
      (row) => row.id === params.id && row.projectId === params.projectId,
    );
    if (index >= 0) this.memory.graphTriggerSent.splice(index, 1);
    return Promise.resolve();
  }

  markResolvedById(params: { id: string; projectId: string; now: Instant }): Promise<void> {
    for (const row of this.memory.graphTriggerSent) {
      if (row.id !== params.id || row.projectId !== params.projectId) continue;
      row.resolvedAt = new Date(params.now.epochMilliseconds);
    }
    return Promise.resolve();
  }

  private open() {
    return this.memory.graphTriggerSent.filter((row) => row.resolvedAt === null);
  }

  private matches(
    row: { triggerId: string; projectId: string; customGraphId: string },
    params: { triggerId: string; projectId: string; customGraphId: string },
  ): boolean {
    return (
      row.triggerId === params.triggerId &&
      row.projectId === params.projectId &&
      row.customGraphId === params.customGraphId
    );
  }

  private asOpen(row: {
    id: string;
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): OpenGraphTriggerSent {
    return {
      id: row.id,
      triggerId: row.triggerId,
      projectId: row.projectId,
      customGraphId: row.customGraphId,
    };
  }
}
