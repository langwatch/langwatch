import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { EmailDeliveryAdapter, type EmailDeliveryPort } from "@langwatch/notification-server";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { ApiConfig } from "../platform/config/api.config";

/**
 * The one outbound mail graph an interactive process holds, and the host its
 * messages link back to.
 *
 * The twin of `apps/worker/src/app/worker-mail.composition.ts`, deliberately
 * down to the field names: the two processes send from the same deployment,
 * and a password-reset link leaving here from a different sender domain than
 * the settlement digest leaving the worker would fail one SPF policy and pass
 * the other.
 *
 * There is no `MailRenderPort` here, and that is the one shape difference.
 * The worker renders WORDS for envelopes it assembles itself — the BCC fan-out,
 * the no-reply `To`, the signed unsubscribe footer — so it holds a renderer and
 * writes the envelope. Every message this process sends is a WHOLE send that
 * `@langwatch/mail` owns end to end (`sendResetPasswordEmail`,
 * `sendUsageLimitEmail`): one recipient, one subject, no footer to sign. Those
 * take the gateway and render internally, so a renderer here would be a second
 * way to say the same thing.
 *
 * That the templates may be reached at all is not an exception being made.
 * `@langwatch/mail` is the ONE terminal `frontend-boundary.unit.test.ts` allows
 * a backend graph to enter — react-email renders server-side, at send time —
 * and the walk stops on entry to it.
 */
export type ApiMailComposition = Readonly<{
  delivery: EmailDeliveryPort;
  baseHost: string;
}>;

/**
 * Composes outbound mail, or reports that this graph has none.
 *
 * Two things have to be true, and they are the worker's two. The deployment
 * must have named a `BASE_HOST` — every message links back through it and the
 * sender address is derived from it, which is why `resolveApiMailConfig`
 * answers nothing without one — and the composition must own a resource scope,
 * because a mail gateway holds a transport (an SMTP pool, an SES client, a
 * proxy dispatcher) and a graph that cannot close one would leak it for the
 * life of the process.
 *
 * The AWS transport is SHARED wherever there is one to share. A graph handed a
 * substrate it did not build has none to borrow and gets one of its own.
 *
 * That runtime resolves NO outbound proxy, which is this process's existing
 * answer rather than a new one: `ApiNoOutboundProxy` already states it for
 * stored objects, because the API reads no proxy configuration and inventing
 * one from an unrelated variable would route traffic through a host nobody
 * chose. A deployment behind a corporate proxy that needs SES or Resend to go
 * through it configures the worker, which does read one.
 */
export function tryCreateApiMailComposition(options: {
  config: ApiConfig;
  aws?: AwsClientProcessRuntime;
  resources?: ResourceScope;
}): ApiMailComposition | undefined {
  const { config, resources } = options;
  if (!config.mail || !resources) return undefined;

  const aws = options.aws ?? ownedAwsRuntime(resources);
  const delivery = EmailDeliveryAdapter.create({
    configuration: config.mail.mailer,
    aws,
    outboundProxy: {},
  });
  resources.own("api mail delivery", () => delivery.close());
  return { delivery, baseHost: config.mail.baseHost };
}

function ownedAwsRuntime(resources: ResourceScope): AwsClientProcessRuntime {
  const aws = AwsClientProcessRuntime.create({ outboundProxy: new ApiMailNoOutboundProxy() });
  resources.own("api mail AWS clients", () => aws.close());
  return aws;
}

/** No outbound proxy, for the reason `ApiNoOutboundProxy` already gives. */
class ApiMailNoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}
