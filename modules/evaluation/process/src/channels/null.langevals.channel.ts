import type { LangevalsChannel } from "./langevals.channel.ts";

/** A deployment without a langevals endpoint: every evaluation answers skipped. */
export class NullLangevalsChannel implements LangevalsChannel {
  static create(): NullLangevalsChannel {
    return new NullLangevalsChannel();
  }

  private constructor() {}

  async post(): Promise<Response> {
    return Response.json([{ status: "skipped", details: "Langevals client not available" }]);
  }
}
