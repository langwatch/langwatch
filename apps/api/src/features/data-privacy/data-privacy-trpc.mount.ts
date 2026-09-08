/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { dataPrivacyTrpcTransport } from "@langwatch/data-privacy-server";

/** The one slice of the process context this namespace reads. */
export interface DataPrivacyHostContext {
  app: Readonly<{ dataPrivacy: DataPrivacyApi }>;
}

export function createDataPrivacyTrpcRouter<TContext extends DataPrivacyHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(dataPrivacyTrpcTransport, (ctx) => ctx.app.dataPrivacy);
}
