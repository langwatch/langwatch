import { ApiAutomationUnavailableError } from "@langwatch/automation-contract";

import {
  AutomationGraphNotifier,
  type GraphAlertDispatchInput,
  type GraphAlertDispatchResult,
} from "../channels/automation-graph-alert.channel.ts";
import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type {
  AutomationClock,
  AutomationRepositories,
} from "../repositories/automation.repositories.ts";
import { AutomationGraphDeliveryService } from "./automation-graph-delivery.service.ts";
import type { AutomationProviderRegistryService } from "./automation-provider-registry.service.ts";
import type { AutomationEmailCapService } from "./email-cap.service.ts";
import { GraphAlertDispatchService } from "./graph-alert-dispatch.service.ts";

/**
 * Main's graph-alert delivery (worker-automation-graph.composition.ts): no public
 * origin means no alert, since every alert links back to it, so it refuses by name.
 */
export class AutomationGraphAlertNotifierService extends AutomationGraphNotifier {
  static create(input: {
    /** The deployment's public origin; absent, every alert refuses. */
    publicBaseUrl: string | undefined;
    repositories: Pick<AutomationRepositories, "triggers" | "suppressions">;
    caps: Readonly<{ emailHourlyCap: number; tenantDailyCap: number }>;
    providers: AutomationProviderRegistryService;
    clock: AutomationClock;
    delivery: AutomationNotificationDelivery;
    emailCaps: AutomationEmailCapService;
  }): AutomationGraphAlertNotifierService {
    if (!input.publicBaseUrl) return new AutomationGraphAlertNotifierService(undefined);

    return new AutomationGraphAlertNotifierService(
      GraphAlertDispatchService.create({
        persistence: AutomationGraphDeliveryService.create(input.repositories),
        emailCaps: input.emailCaps,
        delivery: input.delivery,
        webhooks: input.providers.webhooks,
        clock: input.clock,
        emailHourlyCap: input.caps.emailHourlyCap,
        tenantDailyCap: input.caps.tenantDailyCap,
      }),
    );
  }

  private constructor(private readonly dispatcher: GraphAlertDispatchService | undefined) {
    super();
  }

  dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult> {
    if (!this.dispatcher) {
      return Promise.reject(new ApiAutomationUnavailableError("deliver graph alerts"));
    }
    return this.dispatcher.dispatch(input);
  }
}
