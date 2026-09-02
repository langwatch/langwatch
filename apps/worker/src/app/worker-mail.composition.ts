import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { EmailDeliveryAdapter, type EmailDeliveryPort } from "@langwatch/notification-server";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { WorkerConfig, WorkerOutboundProxyConfig } from "../platform/config/worker.config";

/**
 * The one outbound mail graph a worker process holds, and the host its
 * messages link back to.
 */
export type WorkerMailComposition = Readonly<{
  delivery: EmailDeliveryPort;
  baseHost: string;
}>;

/**
 * Composes outbound mail, or reports that this graph has none.
 *
 * Two things have to be true. The deployment must have named a `BASE_HOST`,
 * because every message this process sends links back through it and the
 * sender address is derived from it; and the composition must own a resource
 * scope, because a mail gateway holds a transport — an SMTP connection pool,
 * an SES client, a proxy dispatcher — and a graph that cannot close one would
 * leak it for the life of the process.
 *
 * The AWS transport is SHARED with the rest of the process wherever there is
 * one to share: the standalone worker composes its own infrastructure and this
 * capability borrows that runtime, so SES sends over the same pooled, proxied
 * handler every other AWS client uses. A graph handed a substrate it did not
 * build has none to borrow, and gets one of its own rather than falling back
 * to the SDK's default handler — which honours no `HTTPS_PROXY` and has no
 * socket timeout, so a self-hosted deployment behind a corporate proxy would
 * simply stop being able to send.
 */
export function tryCreateWorkerMailComposition(options: {
  config: WorkerConfig;
  aws?: AwsClientProcessRuntime;
  resources?: ResourceScope;
}): WorkerMailComposition | undefined {
  const { config, resources } = options;
  if (!config.mail || !resources) return undefined;

  const aws = options.aws ?? ownedAwsRuntime({ config, resources });
  const delivery = EmailDeliveryAdapter.create({
    configuration: config.mail.mailer,
    aws,
    outboundProxy: {
      httpsProxy: config.infrastructure.outboundProxy.https,
      httpProxy: config.infrastructure.outboundProxy.http,
      noProxy: config.infrastructure.outboundProxy.noProxy,
    },
  });
  resources.own("worker mail delivery", () => delivery.close());
  return { delivery, baseHost: config.mail.baseHost };
}

function ownedAwsRuntime({
  config,
  resources,
}: {
  config: WorkerConfig;
  resources: ResourceScope;
}): AwsClientProcessRuntime {
  const aws = AwsClientProcessRuntime.create({
    outboundProxy: WorkerMailProxyResolver.create(config.infrastructure.outboundProxy),
  });
  resources.own("worker mail AWS clients", () => aws.close());
  return aws;
}

/**
 * `NO_PROXY` as the de-facto convention has it: comma separated entries, `*`
 * disables proxying entirely, a leading dot or bare domain matches
 * subdomains, and an optional `:port` suffix is ignored.
 */
class WorkerMailProxyResolver extends OutboundProxyResolverPort {
  static create(config: WorkerOutboundProxyConfig): WorkerMailProxyResolver {
    return new WorkerMailProxyResolver(config);
  }

  private constructor(private readonly config: WorkerOutboundProxyConfig) {
    super();
  }

  tryResolveForHost(hostname: string): string | undefined {
    const proxy = this.config.https ?? this.config.http;
    if (!proxy || this.isBypassed(hostname)) return undefined;
    return proxy;
  }

  private isBypassed(targetHost: string): boolean {
    const noProxy = this.config.noProxy;
    if (!noProxy) return false;

    const host = targetHost.toLowerCase().replace(/:\d+$/, "");
    return noProxy
      .split(",")
      .map((entry) => entry.trim().toLowerCase().replace(/:\d+$/, ""))
      .filter(Boolean)
      .some((entry) => {
        if (entry === "*") return true;
        const bare = entry.startsWith(".") ? entry.slice(1) : entry;
        return host === bare || host.endsWith(`.${bare}`);
      });
  }
}
