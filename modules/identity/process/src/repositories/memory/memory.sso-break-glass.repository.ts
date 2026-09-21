import {
  breakGlassIsLive,
  SsoBreakGlassLastWayInError,
  SsoConnectionActivationBlockedError,
  type BreakGlassBinding,
} from "@langwatch/identity-contract";

import { SsoBreakGlassRepository } from "../sso-break-glass.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/** The ways back in, in memory, with the Prisma twin's refusal semantics. */
export class MemorySsoBreakGlassRepository extends SsoBreakGlassRepository {
  static create(store: MemoryIdentityStore): MemorySsoBreakGlassRepository {
    return new MemorySsoBreakGlassRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async findAllForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    return [...this.store.breakGlassBindings.values()]
      .filter((binding) => binding.organizationId === organizationId)
      .toSorted((left, right) => left.grantedAtMs - right.grantedAtMs);
  }

  async findById({ bindingId }: { bindingId: string }): Promise<BreakGlassBinding | null> {
    return this.store.breakGlassBindings.get(bindingId) ?? null;
  }

  async create({ binding }: { binding: BreakGlassBinding }): Promise<void> {
    this.store.breakGlassBindings.set(binding.bindingId, { ...binding });
  }

  async markSuperseded({
    bindingId,
    supersededAtMs,
  }: {
    bindingId: string;
    supersededAtMs: number;
  }): Promise<void> {
    const binding = this.store.breakGlassBindings.get(bindingId);
    if (!binding || binding.supersededAtMs !== null) return;
    this.store.breakGlassBindings.set(bindingId, { ...binding, supersededAtMs });
  }

  async revokePreservingRecovery({
    bindingId,
    organizationId,
    nowMs,
  }: {
    bindingId: string;
    organizationId: string;
    nowMs: number;
  }): Promise<BreakGlassBinding> {
    const binding = this.store.breakGlassBindings.get(bindingId);
    if (!binding || binding.organizationId !== organizationId) {
      throw new Error(
        `break-glass binding ${bindingId} is not one of organization ${organizationId}'s`,
      );
    }
    if (!breakGlassIsLive({ binding, nowMs })) return binding;

    if (this.recoveryIsProtected({ organizationId })) {
      const otherLive = (await this.findAllForOrganization({ organizationId })).filter(
        (candidate) =>
          candidate.bindingId !== bindingId && breakGlassIsLive({ binding: candidate, nowMs }),
      );
      if (otherLive.length === 0) {
        throw new SsoBreakGlassLastWayInError(
          `binding ${bindingId} is organization ${organizationId}'s only live way back in while a connection is ACTIVE`,
        );
      }
    }

    const revoked = { ...binding, supersededAtMs: nowMs };
    this.store.breakGlassBindings.set(bindingId, revoked);

    return revoked;
  }

  async reserveActivationRecovery({
    organizationId,
    connectionId,
    commandId,
    nowMs,
  }: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    const existing = [...this.store.breakGlassReservations.values()].filter(
      (reservation) =>
        reservation.organizationId === organizationId &&
        (reservation.commandId === commandId || reservation.connectionId === connectionId),
    );
    const repeated = existing.find(
      (reservation) =>
        reservation.commandId === commandId && reservation.connectionId === connectionId,
    );
    if (repeated === undefined && existing.length > 0) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${connectionId}: recovery is already reserved by another activation`,
      );
    }

    const live = (await this.findAllForOrganization({ organizationId })).filter((binding) =>
      breakGlassIsLive({ binding, nowMs }),
    );
    if (live.length === 0) return false;
    if (repeated !== undefined) return true;

    this.store.breakGlassReservations.set(commandId, {
      commandId,
      organizationId,
      connectionId,
    });

    return true;
  }

  async recordWarningsSent({
    bindingId,
    days,
  }: {
    bindingId: string;
    days: number[];
  }): Promise<void> {
    const binding = this.store.breakGlassBindings.get(bindingId);
    if (!binding) return;
    this.store.breakGlassBindings.set(bindingId, {
      ...binding,
      warnedDays: [...binding.warnedDays, ...days],
    });
  }

  async findLiveExpiringBefore({
    beforeMs,
    nowMs,
    limit,
  }: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]> {
    return [...this.store.breakGlassBindings.values()]
      .filter(
        (binding) =>
          binding.supersededAtMs === null &&
          binding.expiresAtMs > nowMs &&
          binding.expiresAtMs <= beforeMs,
      )
      .toSorted((left, right) => left.expiresAtMs - right.expiresAtMs)
      .slice(0, limit);
  }

  /** An ACTIVE connection, or an activation mid-flight, is what makes the
   *  last live binding unrevokable. */
  private recoveryIsProtected({ organizationId }: { organizationId: string }): boolean {
    const activeConnection = [...this.store.ssoConnections.values()].some(
      (connection) => connection.organizationId === organizationId && connection.state === "ACTIVE",
    );
    const reserved = [...this.store.breakGlassReservations.values()].some(
      (reservation) => reservation.organizationId === organizationId,
    );

    return activeConnection || reserved;
  }
}
