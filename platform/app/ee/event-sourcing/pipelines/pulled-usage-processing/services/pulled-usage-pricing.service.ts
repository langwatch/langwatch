import {
  PulledUsagePricingService,
  PulledUsageRatePort,
  type PulledUsagePriceInput,
} from "@langwatch/enterprise-governance-server";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";

class GatewayPulledUsageRatePort extends PulledUsageRatePort {
  static create(): GatewayPulledUsageRatePort {
    return new GatewayPulledUsageRatePort();
  }

  rate(input: Parameters<PulledUsageRatePort["rate"]>[0]) {
    return rateSpendNanoUsd({
      model: input.model,
      usage: {
        ...EMPTY_SPEND_USAGE,
        input_tokens: input.quantities.tokensInput,
        output_tokens: input.quantities.tokensOutput,
        cache_read_input_tokens: input.quantities.tokensCacheRead,
        cache_creation_input_tokens: input.quantities.tokensCacheWrite,
      },
    });
  }
}

export class AppPulledUsagePricingService {
  private constructor(
    private readonly service: PulledUsagePricingService,
  ) {}

  static create(): AppPulledUsagePricingService {
    return new AppPulledUsagePricingService(
      PulledUsagePricingService.create(GatewayPulledUsageRatePort.create()),
    );
  }

  price(input: PulledUsagePriceInput) {
    return this.service.price(input);
  }
}
