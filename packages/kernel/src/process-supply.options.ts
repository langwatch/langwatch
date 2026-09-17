import type { MemberValue, Merge, SupplyModule } from "./process-supply.types.ts";

export class ObservabilitySupply<
  Modules extends readonly SupplyModule[],
  Supplied extends object = Record<never, never>,
> {
  constructor(readonly supplied: Supplied) {}

  withLogging<Value extends MemberValue<Modules, "logging">>(logging: Value) {
    return new ObservabilitySupply<Modules, Merge<Supplied, { logging: Value }>>({
      ...this.supplied,
      logging,
    });
  }

  withTracing<Value extends MemberValue<Modules, "tracing">>(tracing: Value) {
    return new ObservabilitySupply<Modules, Merge<Supplied, { tracing: Value }>>({
      ...this.supplied,
      tracing,
    });
  }

  withMetrics<Value extends MemberValue<Modules, "metrics">>(metrics: Value) {
    return new ObservabilitySupply<Modules, Merge<Supplied, { metrics: Value }>>({
      ...this.supplied,
      metrics,
    });
  }
}

export interface StaticTransportTokens {
  readonly cron?: string;
  readonly langyInternal?: string;
  readonly instanceAdmin?: string;
}

export class TransportAuthSupply {
  constructor(
    readonly staticTokens: StaticTransportTokens = {},
    readonly browserSession: unknown = void 0,
  ) {}

  withStaticTokens(tokens: StaticTransportTokens): TransportAuthSupply {
    return new TransportAuthSupply({ ...this.staticTokens, ...tokens }, this.browserSession);
  }

  withBrowserSession(session: object): TransportAuthSupply {
    return new TransportAuthSupply(this.staticTokens, session);
  }
}
