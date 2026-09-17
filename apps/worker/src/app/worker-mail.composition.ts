import { AwsClientProcessRuntime, OutboundProxyResolver } from "@langwatch/aws-client";
import { ReactEmailMailRenderer, type MailRender } from "@langwatch/mail";
import { EmailDeliveryAdapter, type EmailDelivery } from "@langwatch/notification-server";
import type { ResourceScope } from "@langwatch/kernel";
import type { WorkerConfig, WorkerOutboundProxyConfig } from "../platform/config/worker.config.ts";

/**
 * The renderer is composed here because @langwatch/mail is the ONE package a
 * backend graph may load React through — react-email renders server-side.
 */
export type WorkerMailComposition = Readonly<{
  delivery: EmailDelivery;
  renderer: MailRender;
  baseHost: string;
}>;

/**
 * Requires BASE_HOST and a resource scope; AWS transport is shared with the
 * process.
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
  return {
    delivery,
    renderer: ReactEmailMailRenderer.create(),
    baseHost: config.mail.baseHost,
  };
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
export class WorkerMailProxyResolver extends OutboundProxyResolver {
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
