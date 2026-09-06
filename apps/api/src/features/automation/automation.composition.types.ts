/**
 * ComposedAutomationFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { AutomationApp } from "@langwatch/automation-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  createAutomationTrpcRouter,
  createEmailSuppressionTrpcRouter,
} from "./automation-trpc.mount";

/** The two namespaces this feature mounts, and its `ctx.app` application. */
export type ComposedAutomationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    automation: ReturnType<typeof createAutomationTrpcRouter>;
    emailSuppression: ReturnType<typeof createEmailSuppressionTrpcRouter>;
  };
  /** For `ctx.app.automation`. */
  app: AutomationApp;
  /**
   * The same application, where this process composed one, for the packaged automation
   * REST family and the one-click unsubscribe door.
   */
  service?: AutomationApp | undefined;
}>;
