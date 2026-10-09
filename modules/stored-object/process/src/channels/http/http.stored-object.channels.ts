import type { StoredObjectServerConfig } from "@langwatch/stored-object-contract";

import type { StoredObjectChannels } from "../stored-object.channels.ts";
import { HttpExternalImageChannel } from "./http.external-image.channel.ts";

/** Outside pictures are fetched over HTTP behind the deployment's egress fence. */
export class HttpStoredObjectChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: StoredObjectServerConfig }): StoredObjectChannels {
    return {
      images: HttpExternalImageChannel.create({
        policy: {
          blockLocal: config.blockLocalHttpCalls,
          allowedHosts: config.allowedProxyHosts,
          verifyTls: config.isSaas,
        },
      }),
    };
  }
}
