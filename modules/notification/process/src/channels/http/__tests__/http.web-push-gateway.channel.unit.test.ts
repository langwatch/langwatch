import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { HttpWebPushGatewayChannel } from "../http.web-push-gateway.channel.ts";

/** Nothing listens on the discard port, so a send that passes the fence fails to connect. */
const LOCAL = "https://127.0.0.1:9/push/laptop";

async function failureOf(channel: HttpWebPushGatewayChannel): Promise<DispatchError> {
  const failure = await channel
    .send({ endpoint: LOCAL, headers: {}, body: new Uint8Array() })
    .then(() => undefined)
    .catch((error: unknown) => error);
  if (!(failure instanceof DispatchError)) throw new Error("expected a DispatchError");
  return failure;
}

describe("HttpWebPushGatewayChannel", () => {
  describe("given no configured push service base", () => {
    /** @scenario "Without a configured push service base only the browsers' push services are accepted" */
    it("refuses a local endpoint at the fence, for good", async () => {
      const failure = await failureOf(HttpWebPushGatewayChannel.create());

      expect(failure.retryable).toBe(false);
    });
  });

  describe("given a configured push service base on that origin", () => {
    /** @scenario "A configured push service base is accepted and reached beside the browsers' own" */
    it("lets the send past the fence to the local origin", async () => {
      const failure = await failureOf(
        HttpWebPushGatewayChannel.create({ pushServiceBase: "https://127.0.0.1:9/push" }),
      );

      expect(failure.retryable).toBe(true);
    });
  });
});
