import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailBundleEntry,
  GatewayGuardrailDirection,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";
import { nowInstant, toDate } from "@langwatch/time";

import {
  GatewayGuardrailRepository,
  type GatewayGuardrailCheckRow,
} from "../gateway-guardrail.repository.ts";
import { MemoryGatewayRowNotFoundError, type MemoryGatewayStore } from "./memory.gateway.store.ts";

/** A project's guardrail catalogue over the shared rows, with evaluator slugs from the seed. */
export class MemoryGatewayGuardrailRepository extends GatewayGuardrailRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayGuardrailRepository {
    return new MemoryGatewayGuardrailRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findAll(projectId: string): Promise<GatewayGuardrailResource[]> {
    return this.#live(projectId);
  }

  async findBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]> {
    return this.#live(projectId).map((row) => ({
      id: row.id,
      name: row.name,
      evaluatorId: row.evaluatorId,
      evaluatorSlug:
        this.store.evaluators.find((entry) => entry.id === row.evaluatorId)?.slug ?? null,
      direction: wireDirectionOf(row.direction),
      failureMode: row.failureMode === "FAIL_OPEN" ? "fail_open" : "fail_closed",
    }));
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null> {
    const row = this.store.guardrails.get(input.id);
    return row?.projectId === input.projectId && row.archivedAt === null ? { ...row } : null;
  }

  async create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const now = toDate(nowInstant());
    const row: GatewayGuardrailResource = {
      id: this.store.newId("gatewayguardrail"),
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      evaluatorId: input.evaluatorId,
      direction: input.direction,
      failureMode: input.failureMode ?? "FAIL_CLOSED",
      createdById: input.actorUserId,
      updatedById: input.actorUserId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.guardrails.set(row.id, row);

    return { ...row };
  }

  async update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    return this.#replace(input, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.evaluatorId === undefined ? {} : { evaluatorId: input.evaluatorId }),
      ...(input.direction === undefined ? {} : { direction: input.direction }),
      ...(input.failureMode === undefined ? {} : { failureMode: input.failureMode }),
      updatedById: input.actorUserId,
    });
  }

  async archive(input: ArchiveGatewayGuardrailInput): Promise<void> {
    this.#replace(input, { archivedAt: toDate(nowInstant()), updatedById: input.actorUserId });
  }

  async findRunnableForCheck(input: {
    projectId: string;
    ids: string[];
    direction: GatewayGuardrailDirection;
  }): Promise<GatewayGuardrailCheckRow[]> {
    const ids = new Set(input.ids);
    return [...this.store.guardrails.values()]
      .filter(
        (row) =>
          ids.has(row.id) &&
          row.projectId === input.projectId &&
          row.archivedAt === null &&
          row.direction === input.direction,
      )
      .map(({ id, name, evaluatorId, failureMode }) => ({ id, name, evaluatorId, failureMode }));
  }

  /** Live rows, by direction then name, as the catalogue is listed. */
  #live(projectId: string): GatewayGuardrailResource[] {
    return [...this.store.guardrails.values()]
      .filter((row) => row.projectId === projectId && row.archivedAt === null)
      .toSorted(
        (left, right) =>
          DIRECTION_ORDER.indexOf(left.direction) - DIRECTION_ORDER.indexOf(right.direction) ||
          byCodePoint(left.name, right.name),
      )
      .map((row) => ({ ...row }));
  }

  #replace(
    target: { id: string; projectId: string },
    changes: Partial<GatewayGuardrailResource>,
  ): GatewayGuardrailResource {
    const row = this.store.guardrails.get(target.id);
    if (row?.projectId !== target.projectId) {
      throw new MemoryGatewayRowNotFoundError("guardrail", target.id);
    }
    const next = { ...row, ...changes, updatedAt: toDate(nowInstant()) };
    this.store.guardrails.set(row.id, next);

    return { ...next };
  }
}

/** The enum's declared order, which is how Postgres sorts it. */
const DIRECTION_ORDER: readonly GatewayGuardrailDirection[] = ["PRE", "POST", "STREAM_CHUNK"];

function wireDirectionOf(direction: GatewayGuardrailDirection): "pre" | "post" | "stream_chunk" {
  if (direction === "PRE") return "pre";
  return direction === "POST" ? "post" : "stream_chunk";
}

/** Code-point order; the live read uses the column collation, which may differ off ASCII. */
function byCodePoint(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
