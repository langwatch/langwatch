export type PlanInfo = {
  type: string;
  name: string;
  free: boolean;
  trialDays?: number;
  daysSinceCreation?: number;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  canPublish: boolean;
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
      type: "OPEN_SOURCE",
      name: "Open Source",
      free: true,
      overrideAddingLimitations: true,
      maxMembers: 99_999,
      maxProjects: 9_999,
      maxMessagesPerMonth: 999_999,
      maxWorkflows: 999,
      evaluationsCredit: 999,
      canPublish: true,
      prices: {
        USD: 0,
        EUR: 0,
      },
    };
  }
}
