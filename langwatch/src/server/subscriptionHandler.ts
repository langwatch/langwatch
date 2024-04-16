export type PlanInfo = {
  name: string;
  free: boolean;
  canAlwaysAddNewMembers?: boolean;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  prices: {
    USD: number;
    EUR: number;
  };
};

export abstract class SubscriptionHandler {
  static async getActivePlan(
    _organizationId: string,
    _user?: {
      id: string;
      email?: string | null;
      name?: string | null;
    }
  ): Promise<PlanInfo> {
    return {
      name: "Open Source",
      free: true,
      canAlwaysAddNewMembers: true,
      maxMembers: 99_999,
      maxProjects: 9_999,
      maxMessagesPerMonth: 999_999,
      evaluationsCredit: 999,
      prices: {
        USD: 0,
        EUR: 0,
      },
    };
  }
}
