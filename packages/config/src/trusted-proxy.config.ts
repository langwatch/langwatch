import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * Which hops in front of this process are allowed to name the caller.
 *
 * Empty is the default and the safe answer: a forwarding header is written by
 * whoever sent the request, so trusting one from an arbitrary peer hands every
 * IP-keyed throttle its key. An operator lists the addresses (or IPv4 CIDR
 * ranges) of their own load balancer or CDN egress, and only a request arriving
 * from one of those has its forwarding chain read at all.
 */
export const trustedProxyConfigDefinition = RuntimeConfig.define({
  trustedProxies: Config.value(z.string().optional(), { env: "TRUSTED_PROXY_ADDRESSES" }),
});
