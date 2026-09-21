# ADR-098: `langwatch agent dev` local tunnel loop

**Date:** 2026-08-15

**Status:** Accepted

## Context

Scenarios run from the platform call the registered HTTP agent's URL from our backend, so the agent must be reachable from our side. Developers evaluating simulations ask the same question every time: how do I change my agent locally and rerun the scenarios? Today the answer is to deploy somewhere reachable, which breaks the edit-run loop.

Prior art: LangGraph's `langgraph dev --tunnel` and Shopify's `shopify app dev` both provision Cloudflare quick tunnels, and Shopify writes the URL back into the cloud config on every run. Shopify's issue tracker documents the failure modes: URLs appended instead of replaced, and registered URLs left pointing at dead tunnels. Twilio's CLI restores the previous webhook URL on exit. Stripe's `stripe listen` avoids public ingress entirely with an authenticated outbound relay.

## Decision

We will ship `langwatch agent dev` (alias `langwatch agent tunnel`) in the CLI. It fronts the local agent with a small auth proxy that requires a per-session `X-LangWatch-Dev-Secret` header, provisions a Cloudflare quick tunnel via the `cloudflared` npm package (MIT wrapper over the Apache-2.0 binary, downloaded on first use with the Cloudflare terms surfaced), PATCHes the chosen HTTP agent so `config.url` points at the tunnel and `config.devTunnel = { previousUrl, connectedAt }` records the restore target, and on exit restores the previous URL and removes both the marker and the secret header row. Replace, never append. `--tunnel-url` accepts a user-provided tunnel and skips the auth proxy with a printed notice, since a proxy outside the user's own tunnel chain protects nothing. `--no-update-url` prints without touching the agent, `--no-auth` skips the proxy explicitly.

The platform shows the state: agents with `config.devTunnel` get a "Local tunnel" badge in the agents list and the simulations target selector, and a transport-level failure calling such an agent classifies as the handled error `agent_dev_tunnel_unreachable`, whose copy says the tunnel session probably ended.

## Rationale / Trade-offs

Quick tunnels need no account and no signup, which is the right friction level inside an onboarding loop; ngrok requires an account and an authtoken paste, localtunnel is unmaintained, and Microsoft dev tunnels require a Microsoft account. Quick tunnels buffer server-sent events and carry no SLA; scenario calls are plain JSON POST, so the buffering does not apply, and the BYO flag covers reliability needs. An authenticated outbound relay through our own infrastructure (the Stripe `listen` model) is the recorded future transport: no public URL, auth via the existing API key. The transport being an implementation detail of `agent dev` keeps that swap non-breaking. The per-session secret exists because a public tunnel URL in front of an agent wired to the user's LLM keys must not be an open relay.

## Consequences

The local loop becomes: `langwatch agent dev --port 8010`, edit code, rerun the suite, Ctrl-C. A killed process skips the restore and leaves a dead tunnel URL on the agent; the badge and the `agent_dev_tunnel_unreachable` copy make that visible, and the next `agent dev` run replaces it. A TTL cleanup was considered and dropped for v1.

## Amendment: the relay is ADR-128, `agent dev` stays for HTTP agents

The "authenticated outbound relay through our own infrastructure, auth via the existing API key" this ADR recorded as the intended successor transport is [ADR-128](128-connected-agents.md). A connected agent opens the relay itself from the customer's process, so a local agent is a target with no tunnel, no public URL and no URL rewrite on the agent row.

`langwatch agent dev` is not replaced by it. The relay needs the SDK inside the agent's process, which a customer cannot always give: another language, or no access to the code. Those agents stay HTTP agents, and `agent dev` stays the local loop for them. It keeps its Cloudflare quick tunnel, its per-session secret proxy, its URL restore on exit and the `agent_dev_tunnel_unreachable` copy, all unchanged.

What changes is the recommendation. Docs, skills and MCP descriptions offer the decorator first and `agent dev` under HTTP agents.

## Amendment: the primary name is `agent tunnel`

[ADR-129](129-langy-local-control.md) gives Langy a way to work in the developer's own folder through `langwatch langy --share-control`. The word "dev" in `agent dev` reads as that feature, so the tunnel is documented as `langwatch agent tunnel` from now on. `agent dev` stays as a hidden alias and keeps this ADR's behaviour unchanged.

## References

- Related ADRs: ADR-097 (scenario remote-trace judging), ADR-128 (connected agents)
- Spec: `specs/agents/agent-dev-tunnel.feature`
- Review draft: https://nexus.langwatch.ai/wiki/agent-dev-tunnel-adr
