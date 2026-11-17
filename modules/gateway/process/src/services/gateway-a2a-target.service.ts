import { createHash } from "node:crypto";

import {
  GatewayA2aTargetNameTakenError,
  GatewayA2aTargetNotFoundError,
  createGatewayA2aTargetInputSchema,
  updateGatewayA2aTargetInputSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
  type GatewayA2aTargetWire,
  type UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";

import type { GatewayA2aTargetRepository } from "../repositories/gateway-a2a-target.repository.ts";
import type {
  GatewayChangeEventKind,
  GatewayChangeEventsRepository,
} from "../repositories/gateway-change-event.repository.ts";
import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../repositories/gateway-transaction.repository.ts";
import { a2aTargetAdmitsKey, a2aTargetsForProject } from "../rules/gateway-a2a-target.rules.ts";

/** The A2A target registry: one name per scope (org-wide or one project). */
export class GatewayA2aTargetService {
  static create(input: {
    repository: GatewayA2aTargetRepository;
    changeEvents: GatewayChangeEventsRepository;
    transactions: GatewayTransactionRepository;
  }): GatewayA2aTargetService {
    return new GatewayA2aTargetService(input.repository, input.changeEvents, input.transactions);
  }

  private constructor(
    private readonly repository: GatewayA2aTargetRepository,
    private readonly changeEvents: GatewayChangeEventsRepository,
    private readonly transactions: GatewayTransactionRepository,
  ) {}

  /** Writes the target and bumps the change feed in one transaction, so gateways always refetch. */
  private announce(
    kind: GatewayChangeEventKind,
    write: (transaction: GatewayPersistenceTransaction) => Promise<GatewayA2aTargetResource>,
  ): Promise<GatewayA2aTargetResource> {
    return this.transactions.run(async (transaction) => {
      const target = await write(transaction);
      await this.changeEvents.append(
        {
          organizationId: target.organizationId,
          projectId: target.projectId,
          kind,
          payload: { a2aTargetId: target.id },
        },
        transaction,
      );
      return target;
    });
  }

  list(organizationId: string): Promise<GatewayA2aTargetResource[]> {
    return this.repository.findAll(organizationId);
  }

  async create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = createGatewayA2aTargetInputSchema.parse(input);
    const existing = await this.repository.findAll(parsed.organizationId);
    if (existing.some((t) => t.name === parsed.name && t.projectId === parsed.projectId)) {
      throw new GatewayA2aTargetNameTakenError(parsed.name);
    }
    return this.announce("A2A_TARGET_CREATED", (tx) => this.repository.create(parsed, tx));
  }

  async update(input: UpdateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = updateGatewayA2aTargetInputSchema.parse(input);
    if (!(await this.repository.findById(parsed))) throw new GatewayA2aTargetNotFoundError();
    return this.announce("A2A_TARGET_UPDATED", (tx) => this.repository.update(parsed, tx));
  }

  async archive(input: { id: string; organizationId: string }): Promise<GatewayA2aTargetResource> {
    if (!(await this.repository.findById(input))) throw new GatewayA2aTargetNotFoundError();
    return this.announce("A2A_TARGET_DELETED", (tx) => this.repository.archive(input, tx));
  }

  /** The bundle's `a2a_targets`: the key's project and org-wide targets the key may call. */
  async bundleFor(input: {
    organizationId: string;
    projectId: string | null;
    virtualKeyId: string;
  }): Promise<GatewayA2aTargetWire[]> {
    const targets = await this.repository.findAll(input.organizationId);
    return a2aTargetsForProject({ targets, projectId: input.projectId }).filter((target) =>
      a2aTargetAdmitsKey({ target, virtualKeyId: input.virtualKeyId }),
    );
  }

  /** Changes whenever a target the key's bundle carries changes, for the config version token. */
  async bundleFingerprint(input: {
    organizationId: string;
    projectId: string | null;
    virtualKeyId: string;
  }): Promise<string> {
    const wire = await this.bundleFor(input);
    if (wire.length === 0) return "";
    return createHash("sha256").update(JSON.stringify(wire)).digest("hex").slice(0, 16);
  }

  async setBlocked(input: {
    id: string;
    organizationId: string;
    blocked: boolean;
    blockReason: string | null;
    actorUserId: string;
  }): Promise<GatewayA2aTargetResource> {
    return this.update({
      id: input.id,
      organizationId: input.organizationId,
      blocked: input.blocked,
      blockReason: input.blocked ? input.blockReason : null,
      actorUserId: input.actorUserId,
    });
  }
}
