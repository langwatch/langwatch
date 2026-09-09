/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AutomationApp } from "@langwatch/automation-server";

/** This feature's `ctx.app` application. Its two tRPC namespaces are not here:
 * their transport is unconverted. */
export type ComposedAutomationFeature = Readonly<{
  /** For `ctx.app.automation`. */
  app: AutomationApp;
  /**
   * The same application, where this process composed one, for the packaged automation
   * REST family and the one-click unsubscribe door.
   */
  service?: AutomationApp | undefined;
}>;
