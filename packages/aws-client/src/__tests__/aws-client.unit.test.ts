import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AwsClientConfiguration,
  OutboundProxyResolverPort,
  staticCredentialsOrUndefined,
  type AwsClientConfigInput,
} from "../aws-client";

type RecordedNodeHttpHandler = {
  destroy: () => void;
  options: unknown;
};

// The assume-role branch builds a provider whose shape nothing else can read
// back: `fromTemporaryCredentials` returns an opaque function. Mocking it is
// the only way to assert on ExternalId, which is the confused-deputy control.
vi.mock("@aws-sdk/credential-providers", () => ({
  fromTemporaryCredentials: vi.fn(() => vi.fn()),
}));

// A recorder of its own arguments, so the timeouts and the agent a handler was
// built with are readable without touching the real class's private fields.
const { createdHandlers, nodeHttpHandlerMock } = vi.hoisted(() => {
  const createdHandlers: RecordedNodeHttpHandler[] = [];
  const nodeHttpHandlerMock = vi.fn(function (this: RecordedNodeHttpHandler, options: unknown) {
    this.options = options;
    this.destroy = vi.fn();
    createdHandlers.push(this);
  });
  return { createdHandlers, nodeHttpHandlerMock };
});

vi.mock("@smithy/node-http-handler", () => ({ NodeHttpHandler: nodeHttpHandlerMock }));

const { httpsProxyAgentMock } = vi.hoisted(() => ({
  httpsProxyAgentMock: vi.fn(function (this: { url: string }, url: string) {
    this.url = url;
  }),
}));

vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent: httpsProxyAgentMock }));

/**
 * The options a handler was built with. A real `NodeHttpHandler` resolves them
 * lazily behind a private field, so the handler is mocked as a recorder of its
 * own arguments rather than read by reflection.
 */
function handlerOptions(handler: unknown): {
  connectionTimeout?: number;
  requestTimeout?: number;
  httpAgent?: unknown;
  httpsAgent?: unknown;
} {
  return (handler as { options: Record<string, unknown> }).options;
}

/**
 * The invariant these tests exist for broke IRSA in production once: a
 * `credentials` object built from unset environment variables reaches the SDK
 * as `{accessKeyId: "", secretAccessKey: ""}`, which the SDK treats as a real
 * answer and stops looking with. The pod had a role, and we told it we had
 * keys.
 */
class RecordingProxyResolver extends OutboundProxyResolverPort {
  readonly hosts: string[] = [];

  constructor(private readonly proxyForHost: (hostname: string) => string | undefined) {
    super();
  }

  tryResolveForHost(hostname: string): string | undefined {
    this.hosts.push(hostname);
    return this.proxyForHost(hostname);
  }
}

let aws: AwsClientConfiguration;
let outboundProxy: RecordingProxyResolver;
let proxyUrl: string | undefined;

function buildAwsClientConfig(input: AwsClientConfigInput) {
  return aws.build(input);
}

describe("buildAwsClientConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdHandlers.length = 0;
    proxyUrl = undefined;
    outboundProxy = new RecordingProxyResolver(() => proxyUrl);
    aws = AwsClientConfiguration.create({
      outboundProxy,
    });
  });

  describe("given an incomplete credential pair", () => {
    it("omits credentials entirely rather than sending empty strings", () => {
      for (const credentials of [
        { accessKeyId: "", secretAccessKey: "" },
        { accessKeyId: "AKIA1", secretAccessKey: "" },
        { accessKeyId: "", secretAccessKey: "s3cr3t" },
        { accessKeyId: "   ", secretAccessKey: "s3cr3t" },
        { accessKeyId: undefined, secretAccessKey: undefined },
        { accessKeyId: null, secretAccessKey: null },
      ]) {
        expect(staticCredentialsOrUndefined(credentials)).toBeUndefined();
        const config = buildAwsClientConfig({
          region: "eu-central-1",
          targetHost: "sqs.eu-central-1.amazonaws.com",
          staticCredentials: credentials,
        });
        // Absent, not present-and-empty. `in` rather than a truthiness check:
        // an empty object under the key is exactly the failure mode.
        expect("credentials" in config).toBe(false);
      }
    });
  });

  describe("given a complete credential pair", () => {
    it("passes a complete pair through, trimmed", () => {
      const config = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        staticCredentials: {
          accessKeyId: " AKIA1 ",
          secretAccessKey: " s3cr3t ",
        },
      });
      expect(config.credentials).toEqual({
        accessKeyId: "AKIA1",
        secretAccessKey: "s3cr3t",
      });
    });

    it("carries a session token only when there is one", () => {
      expect(
        staticCredentialsOrUndefined({
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
          sessionToken: "",
        }),
      ).toEqual({ accessKeyId: "AKIA1", secretAccessKey: "s3cr3t" });
      expect(
        staticCredentialsOrUndefined({
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
          sessionToken: "tok",
        }),
      ).toMatchObject({ sessionToken: "tok" });
    });
  });

  describe("when a caller sits behind its own retry ladder", () => {
    it("turns the SDK's retries off only when asked", () => {
      const laddered = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        disableSdkRetries: true,
      });
      expect(laddered.maxAttempts).toBe(1);

      const plain = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "email.eu-central-1.amazonaws.com",
      });
      // Absent, so the SDK's own default stands: a caller with no ladder above
      // it would lose transient failures otherwise.
      expect("maxAttempts" in plain).toBe(false);
    });
  });

  describe("when no region is given", () => {
    it("leaves the field out so the SDK resolves it", () => {
      const config = buildAwsClientConfig({
        targetHost: "email.eu-central-1.amazonaws.com",
      });
      expect("region" in config).toBe(false);
    });
  });

  describe("when a role is assumed", () => {
    const paramsOfLastCall = () => vi.mocked(fromTemporaryCredentials).mock.lastCall![0]!;

    /**
     * The ExternalId is what proves the AssumeRole request came from us rather
     * than from anyone who learned the role's name, so it has to reach the
     * provider. Asserting only that a function came back kept passing with the
     * ExternalId deleted.
     */
    it("passes the role, the external id and the session through to the provider", () => {
      const config = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        assumeRole: {
          roleArn: "arn:aws:iam::123456789012:role/langwatch",
          externalId: "lw-abc",
        },
      });

      expect(typeof config.credentials).toBe("function");
      expect(paramsOfLastCall().params).toEqual({
        RoleArn: "arn:aws:iam::123456789012:role/langwatch",
        RoleSessionName: "langwatch",
        ExternalId: "lw-abc",
        DurationSeconds: 900,
      });
    });

    it("omits the external id rather than sending an empty one", () => {
      buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        assumeRole: {
          roleArn: "arn:aws:iam::123456789012:role/langwatch",
          externalId: "   ",
        },
      });

      expect("ExternalId" in paramsOfLastCall().params).toBe(false);
    });

    /**
     * A static pair beside a role means "these keys may assume that role". It
     * has to reach the provider as its master credentials, or the deployment's
     * own identity does the assuming and the customer's keys are ignored.
     */
    it("hands the outer static pair to the provider as its master credentials", () => {
      buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        staticCredentials: {
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        assumeRole: {
          roleArn: "arn:aws:iam::123456789012:role/langwatch",
        },
      });

      expect(paramsOfLastCall().masterCredentials).toEqual({
        accessKeyId: "AKIA1",
        secretAccessKey: "s3cr3t",
      });
    });

    // The AssumeRole leg is a second request to a second host, and it runs
    // before every delivery on a cold client. Unbounded, it is the one that
    // hangs a delivery worker with nothing left to end it.
    it("bounds the STS call the same way it bounds the service call", () => {
      buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        assumeRole: {
          roleArn: "arn:aws:iam::123456789012:role/langwatch",
        },
      });

      const stsHandler = paramsOfLastCall().clientConfig?.requestHandler;
      expect(stsHandler).toBeDefined();
      expect(handlerOptions(stsHandler)).toMatchObject({
        connectionTimeout: 5_000,
        requestTimeout: 20_000,
      });
    });

    /**
     * The China partition serves both SQS and STS under .amazonaws.com.cn, and
     * queue URLs in that partition are admitted. The STS host is only ever
     * handed to the proxy resolver, so spelling it .amazonaws.com asks the
     * bypass rules about a host that does not exist: a rule written for the
     * partition never matches, and the two legs take opposite proxy decisions.
     */
    it("resolves the proxy against the China partition's own STS host", () => {
      outboundProxy = new RecordingProxyResolver((hostname) =>
        hostname.endsWith(".amazonaws.com.cn") ? undefined : "http://proxy.corp:8080",
      );
      aws = AwsClientConfiguration.create({ outboundProxy });

      buildAwsClientConfig({
        region: "cn-north-1",
        targetHost: "sqs.cn-north-1.amazonaws.com.cn",
        assumeRole: {
          roleArn: "arn:aws-cn:iam::123456789012:role/langwatch",
        },
      });

      const stsHandler = paramsOfLastCall().clientConfig?.requestHandler;
      expect(handlerOptions(stsHandler).httpsAgent).toBeUndefined();
      expect(outboundProxy.hosts).toContain("sts.cn-north-1.amazonaws.com.cn");
    });
  });

  describe("when an outbound proxy applies", () => {
    it("resolves the target hostname and uses one agent for both protocols", () => {
      outboundProxy = new RecordingProxyResolver(() => "http://proxy.corp:8080");
      aws = AwsClientConfiguration.create({ outboundProxy });

      const config = buildAwsClientConfig({
        targetHost: "https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails",
      });

      expect(outboundProxy.hosts).toEqual(["email.eu-central-1.amazonaws.com"]);
      expect(httpsProxyAgentMock).toHaveBeenCalledWith("http://proxy.corp:8080");
      expect(handlerOptions(config.requestHandler)).toMatchObject({
        httpAgent: expect.anything(),
        httpsAgent: expect.anything(),
      });
      expect(handlerOptions(config.requestHandler).httpsAgent).toBe(
        handlerOptions(config.requestHandler).httpAgent,
      );
    });

    it("normalizes a scheme-less endpoint before resolving its proxy", () => {
      buildAwsClientConfig({ targetHost: "mail-relay.internal.corp:465" });

      expect(outboundProxy.hosts).toEqual(["mail-relay.internal.corp"]);
    });

    it("reuses the handler and socket pool for one proxy URL", () => {
      outboundProxy = new RecordingProxyResolver(() => "http://reused.corp:8080");
      aws = AwsClientConfiguration.create({ outboundProxy });

      const first = buildAwsClientConfig({ targetHost: "email.eu-central-1.amazonaws.com" });
      const second = buildAwsClientConfig({ targetHost: "sqs.eu-central-1.amazonaws.com" });

      expect(second.requestHandler).toBe(first.requestHandler);
      expect(httpsProxyAgentMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no proxy applies", () => {
    /**
     * `@smithy/node-http-handler` reads 0 as "no timeout" and 0 is its
     * default, so leaving the handler to the SDK is what let a request with no
     * answer sit open for as long as the socket did.
     */
    it("still hands the client a bounded request handler", () => {
      const config = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
      });

      expect(handlerOptions(config.requestHandler)).toEqual({
        connectionTimeout: 5_000,
        requestTimeout: 20_000,
      });
    });

    it("reuses the one handler rather than a socket pool per client", () => {
      const first = buildAwsClientConfig({
        targetHost: "sqs.eu-central-1.amazonaws.com",
      });
      const second = buildAwsClientConfig({
        targetHost: "email.eu-central-1.amazonaws.com",
      });

      expect(first.requestHandler).toBe(second.requestHandler);
    });
  });

  describe("when the process shuts down", () => {
    it("creates no request handler until a client config needs one", () => {
      expect(nodeHttpHandlerMock).not.toHaveBeenCalled();
    });

    it("closes one handler pool once, even when shutdown races with itself", async () => {
      buildAwsClientConfig({ targetHost: "email.eu-central-1.amazonaws.com" });
      proxyUrl = "http://proxy.corp:8080";
      buildAwsClientConfig({ targetHost: "sqs.eu-central-1.amazonaws.com" });

      const [direct, proxied] = createdHandlers;
      if (!direct || !proxied) throw new Error("Expected direct and proxied request handlers");

      const firstClose = aws.close();
      const concurrentClose = aws.close();

      expect(concurrentClose).toBe(firstClose);
      expect(() => buildAwsClientConfig({ targetHost: "sns.eu-central-1.amazonaws.com" })).toThrow(
        "AwsClientConfiguration is closed",
      );

      await firstClose;
      await concurrentClose;

      expect(direct.destroy).toHaveBeenCalledTimes(1);
      expect(proxied.destroy).toHaveBeenCalledTimes(1);
      expect(nodeHttpHandlerMock).toHaveBeenCalledTimes(2);
    });
  });
});
