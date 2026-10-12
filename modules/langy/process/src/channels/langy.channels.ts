import type { LangyLocalWorkspaceChannel } from "./langy-local-workspace.channel.ts";
import type { LangyWorker } from "./langy-worker.channel.ts";

/** Every channel langy holds, as the container hands them to the module class. */
export interface LangyChannels {
  readonly worker: LangyWorker;
  /** What one pod tells the pod holding a conversation's folder. */
  readonly workspace: LangyLocalWorkspaceChannel;
}
