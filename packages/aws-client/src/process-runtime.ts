import type { OutboundProxyResolver } from "./aws-client.ts";
import {
  AwsClientConfiguration,
  type AwsClientConfig,
  type AwsClientConfigInput,
} from "./aws-client.ts";

/**
 * The AWS transport owner for one executable process.
 * Manages shared handler pools; clients borrow from here and own themselves.
 */
export class AwsClientProcessRuntime {
  static create(options: { outboundProxy: OutboundProxyResolver }): AwsClientProcessRuntime {
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
