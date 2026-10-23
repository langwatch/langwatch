# ADR-187: The egress fence carries a request through the outbound proxy

**Date:** 2026-10-22

**Status:** Proposed

## Context

Self-hosted installs often reach the internet only through a corporate HTTP
proxy. Issue #8937: registering an OpenID Connect connection on such an install
timed out with `sso_issuer_unreachable`, and the domain verification file failed
the same way.

Both requests go through `fetchValidatedDestination` in `@langwatch/egress`. It
judges a destination (public address, no cloud metadata, the allowlist), then
pins the socket to the address it judged, so a name cannot resolve one way for
the check and another for the connection. A pinned socket never uses
`HTTPS_PROXY`, and on these networks a direct connection goes nowhere.

The email gateways and the AWS clients already use the proxy, through
`resolveProxyForHost` in the same package. ARCHITECTURE.md §6 makes
`outboundProxy` a process fact each module picks, and §5 makes SSRF and the
outbound proxy egress's.

## Decision

**The fenced fetch takes an optional `proxy` setting and chooses the route per
hop, after judging it.** For each hop:

1. The destination is judged exactly as before. A refusal sends nothing, to the
   proxy or anywhere else.
2. If `resolveProxyForHost` returns a proxy for the hop's host, the request goes
   through undici's `ProxyAgent` (a CONNECT tunnel for https), with the same TLS
   and timeout policy as a pinned hop.
3. Otherwise the socket is pinned to the judged address, as before.

A redirect is judged again and its route chosen again. The setting travels with
the request options, so every hop sees it.

**`NO_PROXY` chooses a route, never a policy.** A host it names is reached
directly; it is still judged. Reaching a private identity provider still takes
`SSO_TRUSTED_IDP_ORIGINS`.

**A caller may route a judged hop around the proxy.** `bypassProxy` is asked per
hop, redirects included. Issuer discovery uses it for an origin in
`SSO_TRUSTED_IDP_ORIGINS`: that origin answers inside the network, so it keeps
the direct connection pinned to the address it resolved to, and an install that
sets `HTTPS_PROXY` for email does not lose its internal identity provider.

**A malformed proxy setting is the operator's error, not the destination's.**
It fails as `OutboundProxyMisconfiguredError`, which names the setting and not
its value, since the value may carry credentials.

**Callers opt in.** Leaving `proxy` out keeps today's behaviour. A module passes
`parseOutboundProxyConfig(config.outboundProxy)` from the leaf it picks. Identity
does so for issuer discovery and the domain proof file.

## Alternatives

- **`EnvHttpProxyAgent`**, as the issue's patch did. It parses `NO_PROXY` itself,
  a second copy of the rules beside `isProxyBypassed`, and they can disagree.
- **`NODE_USE_ENV_PROXY=1` or a global dispatcher.** It changes every request the
  process makes, including ones meant to go direct, and the fence's pinned
  agent would ignore it anyway.
- **Pin the CONNECT target to the judged IP.** The tunnel would carry an IP
  where the proxy expects a hostname. Corporate proxies allow or deny by
  hostname and log it, so this would break the operators the change is for.

## Consequences

A proxied hop is resolved by the proxy, not pinned. The address judged is not
guaranteed to be the one connected to, so the DNS rebinding protection does not
hold for that hop. The operator runs the proxy and decides what it may reach.
Unproxied hops keep the pin.

The judgement still needs the install's own resolver. A public SSO destination
whose name does not resolve locally is refused, proxy or not.

Webhooks, model provider credential checks, web push and external images use the
same fetch and do not pass a proxy yet. SSO sign-in (token exchange, signing
keys) goes through better-auth's use of Node's global `fetch`, which this does
not touch. Both are parked as `@unimplemented` scenarios, in the egress spec and the issuer endpoint spec.

## References

- Issue #8937, PR #8942
- ADR-053: tenant-aware egress and workload isolation
- ADR-167: outbound delivery
- `packages/egress/specs/egress-address-policy.feature`
- `specs/identity/sso-issuer-endpoint-origins.feature`
- `specs/identity/sso-domain-verification.feature`
