import { RawHttpHost, WebSocketHost } from "@langwatch/api";
import { MissingApiDoorError, TransportSelection } from "@langwatch/api/hosting";
import { createLogger } from "@langwatch/observability";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { transportPeersOf } from "../../transport-peers.ts";
import { apiSurface, bearerDoor } from "../api-surface.ts";

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the missing-door refusal reads no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

describe("given a process whose installed modules bind no API door", () => {
  describe("when the API surface is composed at boot", () => {
    /**
     * @scenario "A process that installs no module binding the API door refuses to boot, naming auth"
     */
    it("refuses, naming the auth module to install, and mounts nothing", () => {
      const compose = apiSurface({
        members,
        logger: createLogger("process-server:missing-door-test"),
        stores: { database: false, redis: false },
        bundle: void 0,
        storage: {},
        instanceAdmin: bearerDoor({ name: "instance-admin", token: void 0 }),
        trustedProxies: void 0,
        executionProxyBaseUrl: void 0,
        publicBaseUrl: void 0,
        production: false,
        selection: TransportSelection.create().rest().browserBundle(false),
        sockets: WebSocketHost.create(),
        doors: RawHttpHost.create(),
      });

      expect(() => compose(transportPeersOf(() => ({}), []))).toThrow(MissingApiDoorError);
      expect(() => compose(transportPeersOf(() => ({}), []))).toThrow(/Install "auth"/);
    });
  });
});
