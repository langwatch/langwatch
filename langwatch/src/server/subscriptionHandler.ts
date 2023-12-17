export type SubscriptionLimits = {
  maxMembers: number;
};

export abstract class SubscriptionHandler {
  static async getLimits(_organizationId: string): Promise<SubscriptionLimits> {
    return {
      maxMembers: 99999,
    };
  }
}
