// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { servingEndpointPath } from "../../features/kill-switch/rules/agent-stop-target.rules.ts";
import type { DatabricksServingEndpointChannel } from "../databricks-serving-endpoint.channel.ts";
import {
  type KillSwitchPlatformCode,
  KillSwitchPlatformError,
} from "../kill-switch-platform.channel.ts";

type ServingEndpointCall = { workspaceUrl: string; token: string; path: string };

/** A workspace in memory: every call is recorded; a test seeds the codes a path answers with. */
export class MemoryDatabricksServingEndpointChannel implements DatabricksServingEndpointChannel {
  readonly calls: ServingEndpointCall[] = [];
  private readonly refusals = new Map<string, KillSwitchPlatformCode>();

  private constructor() {}

  static create(): MemoryDatabricksServingEndpointChannel {
    return new MemoryDatabricksServingEndpointChannel();
  }

  /** Every call to `path` throws with `code` until cleared. */
  refuse({ path, code }: { path: string; code: KillSwitchPlatformCode }): void {
    this.refusals.set(path, code);
  }

  /** Clears a seeded refusal: calls to `path` succeed again. */
  allow({ path }: { path: string }): void {
    this.refusals.delete(path);
  }

  async stopEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
  }): Promise<void> {
    this.call({
      ...args,
      path: servingEndpointPath({ endpointName: args.endpointName, action: "stop" }),
    });
  }

  async checkEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
  }): Promise<void> {
    this.call({ ...args, path: servingEndpointPath({ endpointName: args.endpointName }) });
  }

  async startEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
  }): Promise<void> {
    this.call({
      ...args,
      path: servingEndpointPath({ endpointName: args.endpointName, action: "start" }),
    });
  }

  private call({ workspaceUrl, token, path }: ServingEndpointCall): void {
    this.calls.push({ workspaceUrl, token, path });
    const code = this.refusals.get(path);
    if (code) throw new KillSwitchPlatformError({ code, message: `seeded refusal ${code}` });
  }
}
