/**
 * The webhook platform, as an api-role application reads it.
 *
 * A subpath rather than more names on this package's index, and the reason is
 * a real one rather than tidiness: the index also carries the governance and
 * SCIM compositions, so an application that needs only the endpoint registry
 * would pull the whole Enterprise server graph into its program to get it.
 * Everything here is the pull side of ADR-072 — the billing reconciliation
 * REST family answers the SAME envelopes the push side delivers, to the SAME
 * endpoints, judged by the SAME subscription grammar — and nothing else about
 * Enterprise is involved.
 *
 * Two wire rules and three services. The rules are `eventMatches`, the
 * selector grammar a subscription is judged by, and `WebhookEnvelopeService`,
 * the bytes a receiver gets. The services are the endpoint registry a replay
 * names its destination in, the emitted-envelope log it walks, and the
 * delivery path it appends to — which is the WORKER's outbox: an api-role
 * process appends a replayed envelope to an endpoint's coalescing stream and
 * the process that claims the shared queue ships it.
 *
 * They are re-exported rather than restated for the reason this package
 * exists: `apps/api` may name this composition and nothing enterprise below
 * it, and a second reading of the selector grammar, the envelope shape or the
 * endpoint's liveness predicate here would let the pull and the push disagree
 * about what a customer subscribed to, what bytes they receive and which of
 * their endpoints is still deliverable.
 */
export { eventMatches } from "@langwatch/enterprise-webhook-contract";
export {
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEnvelopeService,
  WebhookEventsAdapter,
  WebhookEventsService,
  WebhookIdPort,
  WebhookSecretPort,
  type WebhookDeliveryProcessDeps,
  type WebhookEndpointRuntime,
} from "@langwatch/enterprise-webhook-server";
