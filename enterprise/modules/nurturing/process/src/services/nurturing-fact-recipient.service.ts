// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import { type KeyRecipient, pickKeyRecipient } from "../rules/nurturing-gateway-facts.rules.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";

type FactRecipientDependencies = Readonly<{
  /** Nurturing's erasure marks: no send picks a fact's erased person. */
  erasedUsers: Pick<NurturingErasedUserRepository, "findErased">;
  /** Nurturing's member copy, disabled rows included: who of the fact's people is a member. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfUsers">;
  /**
   * The copied admin: the recipient when no person the fact names is a current member. It names
   * no erased admin.
   */
  admins: Pick<NurturingMemberFactsService, "adminOf">;
}>;

/**
 * Who hears a peer's fact about an organization, read from nurturing's own copies only: a fact
 * names people (a key's holder and creator, a source's creator), and a person who left or was
 * erased must not be told, nor re-attached to the organization's Company.
 */
export class NurturingFactRecipientService {
  static create(dependencies: FactRecipientDependencies): NurturingFactRecipientService {
    return new NurturingFactRecipientService(dependencies);
  }

  private constructor(private readonly dependencies: FactRecipientDependencies) {}

  /**
   * The first named person, else the organization's admin, who is a current member and not
   * erased. An erased person is dropped before the choice, so is never warned of as passed over:
   * a raw fact still names them, and a join racing their erasure can leave a member row until its
   * re-check.
   */
  async recipientOf({
    organizationId,
    named,
  }: Readonly<{
    organizationId: string;
    /** In the order they are preferred; null where the fact names none. */
    named: readonly (string | null)[];
  }>): Promise<KeyRecipient> {
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
    return pickKeyRecipient({ organizationId, holders, memberships, admin });
  }
}
