import {
  AwsClientConfiguration,
  OutboundProxyResolverPort,
  type AwsClientConfig,
  type AwsClientConfigInput,
} from "./aws-client";

/**
 * The AWS transport owner for one executable process.
 *
 * SDK clients are deliberately not retained here. They borrow request
 * handlers from the one configuration and remain owned by their feature
 * adapter; this owner is responsible only for the shared handler pools.
 * Configuration is supplied by the process root so this class never reads
 * environment state or constructs clients in a request/job handler.
 */
export class AwsClientProcessRuntime {
  static create(options: { outboundProxy: OutboundProxyResolverPort }): AwsClientProcessRuntime {
    return new AwsClientProcessRuntime(
      AwsClientConfiguration.create({ outboundProxy: options.outboundProxy }),
    );
  }

  private closePromise: Promise<void> | undefined;

  private constructor(private readonly configuration: AwsClientConfiguration) {}

  build(input: AwsClientConfigInput): AwsClientConfig {
    return this.configuration.build(input);
  }

  /** Closes the process-owned handler pools once, including concurrent calls. */
  close(): Promise<void> {
    this.closePromise ??= this.configuration.close();
    return this.closePromise;
  }
}
