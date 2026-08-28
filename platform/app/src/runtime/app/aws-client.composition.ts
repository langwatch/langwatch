import {
  AwsClientConfiguration,
  OutboundProxyResolverPort,
  type AwsClientConfig,
  type AwsClientConfigInput,
} from "@langwatch/aws-client";
import { resolveProxyForHost, type OutboundProxyConfig } from "~/server/outboundProxy";

class AppOutboundProxyResolver extends OutboundProxyResolverPort {
  constructor(private readonly config: OutboundProxyConfig) {
    super();
  }

  tryResolveForHost(hostname: string): string | undefined {
    return resolveProxyForHost(this.config, hostname);
  }
}

/** A process-owned AWS transport graph for an App or a standalone task. */
export class AppAwsClientConfiguration {
  static create(config: OutboundProxyConfig): AppAwsClientConfiguration {
    return new AppAwsClientConfiguration(
      AwsClientConfiguration.create({
        outboundProxy: new AppOutboundProxyResolver(config),
      }),
    );
  }

  private constructor(private readonly aws: AwsClientConfiguration) {}

  build(input: AwsClientConfigInput): AwsClientConfig {
    return this.aws.build(input);
  }

  close(): Promise<void> {
    return this.aws.close();
  }
}

let configuredAws: AppAwsClientConfiguration | undefined;
let awsTeardown: Promise<void> | undefined;
let awsTeardownPending = false;

export function configureAwsClientConfiguration(config: OutboundProxyConfig): void {
  if (awsTeardownPending) {
    throw new Error("AWS client configuration is closing for this process");
  }
  if (configuredAws) {
    throw new Error("AWS client configuration is already composed for this process");
  }

  configuredAws = AppAwsClientConfiguration.create(config);
  awsTeardown = undefined;
}

export function buildAwsClientConfig(input: AwsClientConfigInput): AwsClientConfig {
  if (!configuredAws) {
    throw new Error("AWS client configuration has not been composed for this process");
  }

  return configuredAws.build(input);
}

export function closeAwsClientConfiguration(): Promise<void> {
  if (awsTeardown) {
    return awsTeardown;
  }

  const closingAws = configuredAws;
  if (!closingAws) {
    return Promise.resolve();
  }

  configuredAws = undefined;
  const teardown = closingAws.close();
  awsTeardown = teardown;
  awsTeardownPending = true;
  void teardown.then(
    () => {
      awsTeardownPending = false;
    },
    () => {
      awsTeardownPending = false;
    },
  );
  return teardown;
}
