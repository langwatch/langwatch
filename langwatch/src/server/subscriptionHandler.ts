export type PlanInfo = {
  name: string;
  free: boolean;
  canAlwaysAddNewMembers?: boolean;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
};

export abstract class SubscriptionHandler {
  static async getActivePlan(
    _user: {
      id: string;
      email?: string | null;
      name?: string | null;
    },
    _organizationId: string
  ): Promise<PlanInfo> {
    return {
      name: "Open Source",
      free: true,
      canAlwaysAddNewMembers: true,
      maxMembers: 99_999,
      maxProjects: 9_999,
      maxMessagesPerMonth: 999_999,
      evaluationsCredit: 999,
    };
  }
}
