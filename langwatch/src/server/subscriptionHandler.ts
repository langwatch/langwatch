export type PlanInfo = {
  name: string;
  free: boolean;
  maxMembers: number;
};

export abstract class SubscriptionHandler {
  static async getActivePlan(_organizationId: string): Promise<PlanInfo> {
    return {
      name: "Open Source",
      free: true,
      maxMembers: 99999,
    };
  }
}
