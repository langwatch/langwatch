// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The person, organization and usage facts one Customer.io profile carries. */
export type NurturingProfile = {
  user: { id: string; email: string | null; name: string | null; createdAt: Date };
  organization: { id: string; name: string; signupData: Record<string, unknown> };
  hasTraces: boolean;
  hasSubscription: boolean;
};

/** The row reads the lifecycle signals make on their own. */
export abstract class NurturingProfileRepository {
  abstract tryFindProfile(userId: string): Promise<NurturingProfile | null>;

  abstract memberUserIds(organizationId: string): Promise<string[]>;
}
