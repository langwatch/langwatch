/**
 * PullerAdapter registry bootstrap. Importing this module wires the
 * built-in adapters into the singleton registry — the BullMQ worker
 * imports it once at startup and then dispatches lookups by adapter id.
 *
 * Add new adapters by registering them here AND exporting them from
 * this module so admin-UI source-type discovery picks them up.
 */
import { CopilotStudioReferencePuller } from "./copilotStudio.puller";
import { HttpPollingPullerAdapter } from "./httpPollingPullerAdapter";
import { pullerAdapterRegistry } from "./pullerAdapter";
import { S3PollingPullerAdapter } from "./s3PollingPullerAdapter";

let registered = false;

export function registerBuiltInPullers(): void {
  if (registered) return;
  pullerAdapterRegistry.register(new HttpPollingPullerAdapter());
  pullerAdapterRegistry.register(new S3PollingPullerAdapter());
  pullerAdapterRegistry.register(new CopilotStudioReferencePuller());
  registered = true;
}

export {
  CopilotStudioReferencePuller,
  HttpPollingPullerAdapter,
  S3PollingPullerAdapter,
  pullerAdapterRegistry,
};
export type {
  HttpPollingConfig,
} from "./httpPollingPullerAdapter";
export type {
  S3PollingConfig,
} from "./s3PollingPullerAdapter";
export type {
  NormalizedPullEvent,
  PullResult,
  PullRunOptions,
  PullerAdapter,
} from "./pullerAdapter";
export { COPILOT_STUDIO_PULL_CONFIG } from "./copilotStudio.puller";
