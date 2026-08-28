import { describe, expect, it } from "vitest";
import { AwsClientProcessRuntime } from "../process-runtime";
import { OutboundProxyResolverPort } from "../aws-client";

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

describe("AwsClientProcessRuntime", () => {
  it("owns one transport configuration and closes it once", async () => {
    const runtime = AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() });

    expect(
      runtime.build({
        targetHost: "sqs.eu-central-1.amazonaws.com",
        region: "eu-central-1",
      }).requestHandler,
    ).toBeDefined();

    const first = runtime.close();
    const second = runtime.close();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(() => runtime.build({ targetHost: "sqs.eu-central-1.amazonaws.com" })).toThrow(
      "AwsClientConfiguration is closed",
    );
  });
});
