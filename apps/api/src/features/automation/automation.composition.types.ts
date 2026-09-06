/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
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
