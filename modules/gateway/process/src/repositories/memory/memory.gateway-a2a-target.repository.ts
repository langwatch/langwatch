import {
  GatewayA2aTargetHeadersNeedReplacingError,
  GatewayA2aTargetNameTakenError,
  createGatewayA2aTargetInputSchema,
  gatewayA2aTargetResourceSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
} from "@langwatch/gateway-contract";
import { nowInstant, toDate } from "@langwatch/time";

import {
  GatewayA2aTargetRepository,
  type GatewayA2aTargetUpdate,
} from "../gateway-a2a-target.repository.ts";

/** A2A targets in memory; headers held in plaintext like the other memory twins. */
export class MemoryGatewayA2aTargetRepository extends GatewayA2aTargetRepository {
  static create(): MemoryGatewayA2aTargetRepository {
    return new MemoryGatewayA2aTargetRepository();
  }

  readonly #rows = new Map<string, GatewayA2aTargetResource>();
  #sequence = 0;

  async findAll(
    organizationId: string,
    options?: { headers?: boolean },
  ): Promise<GatewayA2aTargetResource[]> {
    return [...this.#rows.values()]
      .filter((row) => row.organizationId === organizationId && row.archivedAt === null)
      .map((row) => ({
        ...structuredClone(row),
        ...(options?.headers === false ? { upstreamHeaders: {} } : {}),
      }));
  }

  async findByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<GatewayA2aTargetResource[]> {
    const all = await this.findAll(input.organizationId);
    return all.filter((row) => row.projectId === input.projectId);
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource | null> {
    const row = this.#rows.get(input.id);
    return row?.organizationId === input.organizationId && row.archivedAt === null
      ? structuredClone(row)
      : null;
  }

  async create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const { actorUserId, ...fields } = createGatewayA2aTargetInputSchema.parse(input);
    const taken = [...this.#rows.values()].some(
      (row) =>
        row.archivedAt === null &&
        row.organizationId === fields.organizationId &&
        row.projectId === fields.projectId &&
        row.name === fields.name,
    );
    if (taken) throw new GatewayA2aTargetNameTakenError(fields.name);
    const now = toDate(nowInstant());
    this.#sequence += 1;
    const row = gatewayA2aTargetResourceSchema.parse({
      ...fields,
      id: `gatewaya2atarget_${this.#sequence}`,
      createdById: actorUserId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    this.#rows.set(row.id, row);
    return structuredClone(row);
  }

  async update(input: GatewayA2aTargetUpdate): Promise<GatewayA2aTargetResource> {
    const existing = this.#live(input);
    const {
      id: _id,
      organizationId: _org,
      actorUserId: _actor,
      expectedUpstream,
      ...changes
    } = input;
    if (
      expectedUpstream &&
      (existing.upstreamUrl !== expectedUpstream.upstreamUrl ||
        Object.keys(existing.upstreamHeaders).length > 0 !== expectedUpstream.hasUpstreamHeaders)
    ) {
      throw new GatewayA2aTargetHeadersNeedReplacingError();
    }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    const row = gatewayA2aTargetResourceSchema.parse({
      ...existing,
      ...defined,
      updatedAt: toDate(nowInstant()),
    });
    this.#rows.set(row.id, row);
    return structuredClone(row);
  }

  async archive(input: { id: string; organizationId: string }): Promise<GatewayA2aTargetResource> {
    const existing = this.#live(input);
    const now = toDate(nowInstant());
    const row = { ...existing, archivedAt: now, updatedAt: now };
    this.#rows.set(row.id, row);
    return structuredClone(row);
  }

  /** The stored live row, read without yielding so a write replaces exactly what it read. */
  #live(input: { id: string; organizationId: string }): GatewayA2aTargetResource {
    const row = this.#rows.get(input.id);
    if (row?.organizationId !== input.organizationId || row.archivedAt !== null) {
      throw new Error("A2A target must exist before it is changed");
    }
    return row;
  }
}
