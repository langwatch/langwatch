import { createHmac, timingSafeEqual } from "node:crypto";

import {
  githubWebhookEnvelopeSchema,
  type GithubWebhookEnvelope,
} from "@langwatch/github-contract";

/** Why a webhook delivery was turned away; the transport renders each in main's words. */
export type GithubWebhookRefusal =
  | "not_configured"
  | "invalid_signature"
  | "invalid_json"
  | "invalid_envelope";

export type GithubWebhookReceipt = { refused: GithubWebhookRefusal } | { received: true };

/** The delivery as the door handed it over: the exact bytes and GitHub's headers. */
export type GithubWebhookDelivery = {
  rawBody: string;
  signature: string | undefined;
  eventType: string | undefined;
  deliveryId: string | undefined;
};

/** X-Hub-Signature-256 over the exact bytes GitHub sent, compared in constant time. */
export function isGithubWebhookSignatureValid({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string | undefined;
  secret: string;
}): boolean {
  if (!secret || !signature) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

/** Secret, then signature, then parse: nothing is read from an unverified body. */
export function readGithubWebhook({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string | undefined;
  secret: string;
}): { refused: GithubWebhookRefusal } | { envelope: GithubWebhookEnvelope } {
  if (!secret) return { refused: "not_configured" };
  if (!isGithubWebhookSignatureValid({ rawBody, signature, secret })) {
    return { refused: "invalid_signature" };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { refused: "invalid_json" };
  }

  const envelope = githubWebhookEnvelopeSchema.safeParse(payload);

  return envelope.success ? { envelope: envelope.data } : { refused: "invalid_envelope" };
}
