// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type {
  RecordBudgetCrossingCommandData,
  RecordVkFirstRequestCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";

import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";
import type { NurturingVirtualKeyRepository } from "../repositories/nurturing-gateway-key.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import {
  isKeyOwnBudget,
  keyBudgetPeriodEndOf,
  keyBudgetThresholdSignal,
  keyFirstRequestSignal,
  pickKeyRecipient,
  virtualKeyCreatedSignal,
} from "../rules/nurturing-gateway-facts.rules.ts";
import { isLiveKey, isPersonKey } from "../rules/nurturing-virtual-key.rules.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";

type GatewayFactsDependencies = Readonly<{
  /** Nurturing's key copy: a crossing reads its key's name, holder and state here. */
  keys: Pick<NurturingVirtualKeyRepository, "findKey">;
  /** Nurturing's erasure marks: no send picks a key's erased person. */
  erasedUsers: Pick<NurturingErasedUserRepository, "findErased">;
  /** Nurturing's member copy, disabled rows included: who of the key's people is a member. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfUsers">;
  /**
   * The copied admin: the recipient when a current member and the key's people are not. It names
   * no erased admin.
   */
  admins: Pick<NurturingMemberFactsService, "adminOf">;
  /** Lines carry the key's id and a reason, never a person's id. */
  logger: Readonly<{
    debug(payload: Readonly<Record<string, unknown>>, message: string): void;
    warn(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
}>;

type Deliver = (signal: NurturingSignal) => Promise<void>;

/**
 * Deliveries a key's first request waits for the key's copy: twelve retries, about 27 minutes of
 * the queue's 500ms-doubling backoff capped at 600s, for a copy lagging a backlog or the deploy's
 * replay. Bounded so a key nurturing never copies ends instead of holding its queue group.
 */
export const KEY_FIRST_REQUEST_COPY_ATTEMPTS = 13;

/**
 * Turns gateway's key facts into one person's signal, reading only nurturing's own copies: a
 * created person's key, its first request and its budget's crossings. Machine-owned keys, unknown
 * keys and keys nobody can be found for send nothing.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
export class NurturingGatewayFactsService {
  static create(dependencies: GatewayFactsDependencies): NurturingGatewayFactsService {
    return new NurturingGatewayFactsService(dependencies);
  }

  private constructor(private readonly dependencies: GatewayFactsDependencies) {}

  /** Only a created USER key is told; a rotate, disable, enable or revoke only folds the copy. */
  async virtualKeyCreated({
    data,
    deliver,
  }: Readonly<{ data: RecordVkLifecycleCommandData; deliver: Deliver }>): Promise<void> {
    if (data.action !== "created" || !isPersonKey(data.purpose ?? null)) return;
    const virtualKeyId = data.virtual_key_id;
    const userId = await this.recipientOf({
      organizationId: data.organization_id,
      virtualKeyId,
      holders: [data.principal_user_id ?? null, data.actor_user_id ?? null],
    });
    if (!userId) return this.noRecipient({ virtualKeyId, fact: "virtual_key_created" });
    await deliver(virtualKeyCreatedSignal({ data, userId }));
  }

  /** A crossing of a live USER key's own budget; any other scope is not the key's spend. */
  async keyBudgetCrossed({
    data,
    deliver,
  }: Readonly<{ data: RecordBudgetCrossingCommandData; deliver: Deliver }>): Promise<void> {
    const { virtual_key_id: virtualKeyId, organization_id: organizationId } = data;
    if (!virtualKeyId || !isKeyOwnBudget(data)) return;
    const [key] = await this.dependencies.keys.findKey({ organizationId, virtualKeyId });
    if (!key) {
      this.dependencies.logger.warn(
        { virtualKeyId, reason: "key_not_copied" },
        "a budget crossing names a key nurturing holds no copy of; nothing is sent",
      );
      return;
    }
    if (!isPersonKey(key.purpose) || !isLiveKey(key)) return;
    const userId = await this.recipientOf({
      organizationId,
      virtualKeyId,
      holders: [key.principalUserId, key.creatorUserId],
    });
    if (!userId) return this.noRecipient({ virtualKeyId, fact: "key_budget_threshold" });
    const periodEnd = keyBudgetPeriodEndOf({
      window: data.window,
      periodEndsAtMs: data.period_ends_at_ms ?? null,
    });
    if (periodEnd.outcome === "missing") {
      this.dependencies.logger.warn(
        { virtualKeyId, window: data.window, reason: "period_end_missing" },
        "a rolling budget's crossing names no period end; budget_period_end is left out",
      );
    }
    await deliver(keyBudgetThresholdSignal({ data, key, userId, periodEnd }));
  }

  /**
   * A live USER key's first request, told to whoever its creation was told to: the person a
   * campaign waiting on the key's first use reads. Gateway records a key's first request once,
   * so a key not copied yet fails the delivery to be retried, up to
   * {@link KEY_FIRST_REQUEST_COPY_ATTEMPTS}; a key whose copy never reached nurturing (a lost or failed copy) then ends unsent.
   */
  async keyFirstRequested({
    data,
    deliver,
    deliveryAttempt,
  }: Readonly<{
    data: RecordVkFirstRequestCommandData;
    deliver: Deliver;
    /** The queue's 1-based delivery attempt; absent counts as the first, so the job still retries. */
    deliveryAttempt?: number;
  }>): Promise<void> {
    const { virtual_key_id: virtualKeyId, organization_id: organizationId } = data;
    const [key] = await this.dependencies.keys.findKey({ organizationId, virtualKeyId });
    if (!key) {
      const attempt = deliveryAttempt ?? 1;
      if (attempt < KEY_FIRST_REQUEST_COPY_ATTEMPTS) {
        throw new Error(
          `Key ${virtualKeyId} has no copy in nurturing yet (attempt ${attempt}); retrying its first request`,
        );
      }
      this.dependencies.logger.warn(
        { virtualKeyId, reason: "key_not_copied", deliveryAttempt: attempt },
        "a key's first request names a key nurturing holds no copy of after its retries; nothing is sent",
      );
      return;
    }
    if (!isPersonKey(key.purpose) || !isLiveKey(key)) return;
    const userId = await this.recipientOf({
      organizationId,
      virtualKeyId,
      holders: [key.principalUserId, key.creatorUserId],
    });
    if (!userId) return this.noRecipient({ virtualKeyId, fact: "key_first_request" });
    await deliver(keyFirstRequestSignal({ data, userId }));
  }

  /**
   * The key's holder, its creator or the organization's admin, whoever is a current member and
   * not erased. An erased person is dropped before the choice, so is never warned of as passed
   * over: a raw fact still names them, and a join racing their erasure can leave a member row
   * until its re-check.
   */
  private async recipientOf({
    organizationId,
    virtualKeyId,
    holders: named,
  }: Readonly<{
    organizationId: string;
    virtualKeyId: string;
    holders: readonly (string | null)[];
  }>): Promise<string | null> {
    const isSomeone = (userId: string | null): userId is string => userId !== null;
    const admin = await this.dependencies.admins.adminOf({ organizationId });
    const erased = new Set(
      await this.dependencies.erasedUsers.findErased({ userIds: named.filter(isSomeone) }),
    );
    const holders = named.map((userId) =>
      isSomeone(userId) && erased.has(userId) ? null : userId,
    );
    const userIds = [...holders, admin.kind === "admin" ? admin.userId : null].filter(isSomeone);
    const memberships = await this.dependencies.members.findMembershipsOfUsers({ userIds });
    const { recipient, passedOverWithoutRow } = pickKeyRecipient({
      organizationId,
      holders,
      memberships,
      admin,
    });
    if (passedOverWithoutRow.length > 0) {
      this.dependencies.logger.warn(
        { organizationId, virtualKeyId, reason: "holder_not_in_member_copy" },
        "a key holder with no row in nurturing's member copy was passed over",
      );
    }
    return recipient;
  }

  private noRecipient({
    virtualKeyId,
    fact,
  }: Readonly<{ virtualKeyId: string; fact: string }>): void {
    this.dependencies.logger.debug(
      { virtualKeyId, fact, reason: "no_recipient" },
      "a gateway key fact finds no current member to tell, the admin included; nothing is sent",
    );
  }
}
