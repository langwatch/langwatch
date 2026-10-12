import type { LangyWorker } from "./langy-worker.channel.ts";

/** Every channel langy holds, as the container hands them to the module class. */
export interface LangyChannels {
  readonly worker: LangyWorker;
}
