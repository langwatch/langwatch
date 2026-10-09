// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import { OpsApi } from "@langwatch/ops-contract";
import type { BoundApis } from "@langwatch/process";

import type { SaasChannels } from "../saas.channels.ts";
import { HttpProductAnalyticsChannel } from "./http.product-analytics.channel.ts";

/** Cloud's product analytics goes to PostHog, at the targets ops names (record §5 binding). */
export class HttpSaasChannels {
  static readonly requires = [] as const;
  static readonly binds = { ops: OpsApi } as const;

  static create({ bound }: { bound: BoundApis<typeof HttpSaasChannels.binds> }): SaasChannels {
    return {
      analytics: HttpProductAnalyticsChannel.create({
        targets: () => bound.ops.findProductAnalyticsTargets(),
        logger: createLogger("langwatch:saas"),
      }),
    };
  }
}
