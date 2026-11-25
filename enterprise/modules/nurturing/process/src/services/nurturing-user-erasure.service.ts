// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingVirtualKeyRepository } from "../repositories/nurturing-gateway-key.repository.ts";
import type { NurturingOrganizationAdminRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import type { NurturingPersonalProjectRepository } from "../repositories/nurturing-personal-project.repository.ts";

type UserErasureDependencies = Readonly<{
  personalProjects: Pick<NurturingPersonalProjectRepository, "forgetOwner">;
  organizations: NurturingOrganizationAdminRepository;
  members: Pick<NurturingOrganizationMemberRepository, "forgetMember">;
  virtualKeys: Pick<NurturingVirtualKeyRepository, "forgetUser">;
}>;

/**
 * Takes an erased account out of nurturing's own rows: the personal projects it owned, the
 * organizations naming it admin, its memberships, and the gateway keys naming it creator or
 * holder. The last three mark it erased first, so no read names it admin, and no membership or
 * key a later fact names stores it. It holds no sink, so no Customer.io or PostHog request starts
 * here, and it reads no other module's table. A redelivery finds nothing left and changes
 * nothing.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
export class NurturingUserErasureService {
  static create(dependencies: UserErasureDependencies): NurturingUserErasureService {
    return new NurturingUserErasureService(dependencies);
  }

  private constructor(private readonly dependencies: UserErasureDependencies) {}

  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.dependencies.personalProjects.forgetOwner({ ownerUserId: userId });
    await this.dependencies.organizations.forgetAdmin({ adminUserId: userId });
    await this.dependencies.members.forgetMember({ userId });
    await this.dependencies.virtualKeys.forgetUser({ userId });
  }
}
