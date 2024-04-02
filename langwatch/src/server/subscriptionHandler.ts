export type PlanInfo = {
  name: string;
  free: boolean;
  maxMembers: number;
  canAlwaysAddNewMembers?: boolean;
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
      maxMembers: 99999,
      canAlwaysAddNewMembers: true,
    };
  }
}
