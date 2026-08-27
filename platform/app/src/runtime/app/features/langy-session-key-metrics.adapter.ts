import { LangySessionKeyMetricsPort } from "@langwatch/langy-server";
import { getLangySessionKeysCounter } from "~/server/metrics";

export class AppLangySessionKeyMetricsAdapter extends LangySessionKeyMetricsPort {
  static create(): AppLangySessionKeyMetricsAdapter {
    return new AppLangySessionKeyMetricsAdapter();
  }

  private constructor() {
    super();
  }

  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void {
    const counter = getLangySessionKeysCounter(input.operation);
    if (input.count === void 0) {
      counter.inc();
      return;
    }

    counter.inc(input.count);
  }
}
