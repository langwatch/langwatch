export abstract class WebhookPlanPort {
  abstract hasWebhookEndpoints(organizationId: string): Promise<boolean>;
}
