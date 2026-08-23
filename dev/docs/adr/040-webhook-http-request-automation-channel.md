# ADR-040: Webhook automations use one SSRF-fenced delivery contract

**Date:** 2026-07-10

**Status:** Accepted

**Related:** [typed dispatch errors](./027-typed-dispatcherror-contract.md),
[automation authoring](./037-automation-operator-surfaces.md), and
[automation process managers](./052-automations-on-process-manager-substrate.md).

## Context

A webhook automation sends a customer-authored JSON request from the worker
fleet to a customer-supplied endpoint. That is both a useful integration seam
and an SSRF, credential-disclosure and third-party amplification boundary.

The channel also needs the same retry, idempotency, template and operator
contracts as email and Slack. Those guarantees belong to shared delivery
utilities and the automation process manager, not to ad-hoc code in each
trigger path.

## Decision

`SEND_WEBHOOK` is a notification action in the automation provider registry.
Its browser-safe contract contains:

- an HTTPS URL on the default port;
- `POST`, `PUT` or `PATCH`;
- static custom headers;
- an optional Liquid JSON body template; and
- an optional HMAC signing secret.

The trace, evaluation and graph-alert paths all call the same webhook delivery
service.

### Destination validation is repeated at dispatch

Authoring validation provides fast feedback, but it is not the security
boundary. The sender validates and resolves the destination immediately before
every attempt:

- HTTPS and port policy are enforced unless a deployment-level local override
  explicitly permits an insecure origin;
- URL credentials are rejected;
- loopback, private, link-local, multicast and cloud-metadata addresses are
  rejected;
- DNS is resolved once and the connection is pinned to the accepted address;
- every redirect target is revalidated and re-resolved;
- timeouts and response-size limits are mandatory.

Custom header names must be valid HTTP tokens. Connection-shape headers and
the complete `X-LangWatch-*` namespace are reserved. CR, LF and NUL bytes are
removed from values before storage and dispatch.

### Secrets never round-trip through the client

Header values and signing secrets are encrypted at rest inside the provider's
stored action parameters. Reads return header names plus a `__kept__` sentinel,
never plaintext values. Save and test-fire operations resolve that sentinel
against the stored ciphertext on the server.

Decryption happens immediately before dispatch. URLs, request headers and
rendered request bodies are never copied into process-manager rows or webhook
delivery logs.

### Rendering and signing have stable wire semantics

The body template renders against the shared automation `matches[]` context.
It must produce valid JSON within the configured byte limit. The default body
is a versioned JSON envelope.

Every attempt carries a stable `X-LangWatch-Event-Id` derived from the durable
intent or graph-fire identity. Retries of one logical fire reuse it.

When signing is configured, the sender adds:

```text
X-LangWatch-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
```

The HMAC covers the timestamp and exact body bytes. Signature comparison in
receiver examples uses constant-time equality. Secret rotation may expose a
bounded set of active signing secrets to the sender, newest first.

### The process-manager outbox owns retry

Trace and evaluation webhook intents use `ProcessManagerOutbox`. The sender
throws `DispatchError` with a retry classification:

- 2xx succeeds;
- 429, 5xx and transport failures retry;
- other 4xx responses are terminal;
- `Retry-After` supplies a bounded floor for the next attempt.

There is no second retry loop inside the sender. A per-project hourly cap and
a webhook-specific in-flight semaphore prevent one project or slow receiver
from consuming the delivery pool.

Graph-alert delivery uses the same sender, event identity and classification.
Its fire claim ensures terminal receiver failures are not posted repeatedly on
every evaluation tick.

### Delivery history stores responses, never requests

`WebhookDelivery` records one row per attempt:

- project, trigger and stable dispatch identity;
- outcome, response status and latency;
- a bounded safe error string; and
- on failure, the receiver's bounded response body, headers and retry hint.

Request URL, headers and body are absent from the table. The receiver response
is retained verbatim for diagnosis and may itself contain sensitive content,
so rows are pruned after 30 days by the `webhookDeliveryPrune` scheduled
process manager.

The automation detail drawer groups attempts by dispatch identity and shows
status, latency, retry outcome and the bounded receiver response.

### Layering

- `@langwatch/automations` owns the browser-safe provider schema.
- The web feature owns its configuration and preview components.
- The automation application layer owns encryption, rendering and delivery
  orchestration.
- The shared webhook sender owns SSRF fencing, signing, bounds and HTTP error
  classification.
- Repositories own `WebhookDelivery` persistence; routers expose service
  contracts and never query Prisma directly.

## Alternatives considered

Calling a general-purpose `fetch` from a trigger handler leaves DNS rebinding,
redirects and private-address checks to every call site. Storing plaintext
header values exposes credentials through database reads and browser payloads.
Persisting request content in the delivery log duplicates customer data and
secrets without improving retry. A channel-specific retry loop would compete
with the process-manager lease and attempt state.

## Consequences

- Every webhook automation shares one outbound security boundary.
- Delivery is at-least-once with a stable receiver-visible identity.
- Operators can diagnose receiver failures without exposing stored request
  secrets.
- Webhook attempts add bounded Postgres write volume and a scheduled retention
  obligation.
- Additional authentication modes belong in the provider contract and shared
  sender rather than in individual dispatch paths.

## References

- `packages/automations/src/providers/webhook.ts`
- `platform/app/src/server/webhooks/sendWebhook.ts`
- `platform/app/src/server/app-layer/automations/delivery/deliverWebhook.ts`
- [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
