import fs from "fs";
import path from "path";

import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "~/server/webhooks/signature";

/**
 * Emits the cross-language signature test vectors from the sender's own
 * implementation.
 *
 * Three verifiers have to agree byte for byte: this server, the TypeScript
 * SDK's `verifyWebhookSignature`, and the Python SDK's
 * `verify_webhook_signature`. Agreement asserted in three separate test
 * suites is agreement only until one of them is edited, so the vectors are
 * generated HERE, from the code that actually signs deliveries, and the two
 * SDKs assert against the committed file rather than against a local idea of
 * the algorithm.
 *
 * Regenerate with `pnpm run task generateWebhookSignatureVectors` from
 * platform/app. The companion unit test fails when the committed file drifts
 * from what this task would write, so a change to the signing code cannot
 * land without the vectors moving with it.
 */

/** Where the SDK suites read from, repo-root relative. */
export const VECTORS_RELATIVE_PATH = "specs/webhooks/signature-vectors.json";

/**
 * What a receiver should conclude. The sender's reference verifier answers a
 * plain boolean, but a receiver-facing helper owes the caller the reason: a
 * stale timestamp is a clock or a replay, a bad digest is a wrong secret or a
 * tampered body, and a header that never parsed is a misrouted request. The
 * order below is the order the checks run in, so a case that is both
 * malformed and stale is reported as malformed.
 */
export type VectorOutcome =
  | "valid"
  | "malformed_header"
  | "stale_timestamp"
  | "invalid_signature";

export interface SigningVector {
  name: string;
  why: string;
  /** The exact bytes signed. Never re-serialize before verifying. */
  body: string;
  timestamp: number;
  /** Newest first, exactly as the sender orders them. */
  secrets: string[];
  expected_header: string;
}

export interface VerificationVector {
  name: string;
  why: string;
  body: string;
  header: string;
  /** Every secret the receiver holds. Any one matching is a pass. */
  secrets: string[];
  now_seconds: number;
  /** Absent means the default tolerance. */
  tolerance_seconds?: number;
  expected: VectorOutcome;
}

export interface SignatureVectorFile {
  $schema_note: string;
  generated_by: string;
  generated_from: string;
  algorithm: {
    header: string;
    signed_payload: string;
    digest: string;
    repeated_v1: string;
  };
  default_tolerance_seconds: number;
  signing: SigningVector[];
  verification: VerificationVector[];
}

const NEW_SECRET = "whsec_new_secret_value";
const OLD_SECRET = "whsec_previous_secret_value";
const NEVER_ISSUED = "whsec_never_issued";
const T = 1_753_000_000;

/** A realistic batch envelope, so the vectors exercise a body with structure. */
const BATCH_BODY = JSON.stringify({
  batch: [
    { id: "evt_1", type: "gateway.request.completed" },
    { id: "evt_2", type: "gateway.request.settled" },
  ],
});

/**
 * Non-ASCII and an escaped quote: the pair that breaks a verifier which
 * re-encodes the body instead of hashing the bytes it received.
 */
const UNICODE_BODY = JSON.stringify({ note: 'café "quoted" ✓' });

const sign = (secrets: string[], body: string, timestampSeconds = T): string =>
  signWebhookPayload({ secrets, body, timestampSeconds });

/**
 * The three headers every case below is built from or checked against.
 *
 * Computed once at module load: signing is pure, so the vectors are constant
 * data rather than something a build step has to recompute.
 */
const SINGLE = sign([NEW_SECRET], BATCH_BODY);
const ROTATION = sign([NEW_SECRET, OLD_SECRET], BATCH_BODY);
const UNICODE = sign([NEW_SECRET], UNICODE_BODY);

const SIGNING_VECTORS: SigningVector[] = [
  {
    name: "documented_reference_vector",
    why: "The value the docs quote. Pinned so a published snippet cannot drift from the sender.",
    body: '{"a":1}',
    timestamp: 1_700_000_000,
    secrets: ["whsec_fixed"],
    expected_header: sign(["whsec_fixed"], '{"a":1}', 1_700_000_000),
  },
  {
    name: "single_secret",
    why: "Steady state: one secret, one v1.",
    body: BATCH_BODY,
    timestamp: T,
    secrets: [NEW_SECRET],
    expected_header: SINGLE,
  },
  {
    name: "rotation_two_secrets",
    why: "A rotation window signs with both, newest first, so a receiver reading only the first v1 follows the roll rather than lagging it.",
    body: BATCH_BODY,
    timestamp: T,
    secrets: [NEW_SECRET, OLD_SECRET],
    expected_header: ROTATION,
  },
  {
    name: "unicode_body",
    why: "The digest is over the body's bytes, so non-ASCII must survive without re-encoding.",
    body: UNICODE_BODY,
    timestamp: T,
    secrets: [NEW_SECRET],
    expected_header: UNICODE,
  },
  {
    name: "empty_secret_is_skipped",
    why: "An empty secret signs nothing rather than signing with an empty key.",
    body: BATCH_BODY,
    timestamp: T,
    secrets: ["", NEW_SECRET],
    expected_header: sign(["", NEW_SECRET], BATCH_BODY),
  },
];

const VERIFICATION_VECTORS: VerificationVector[] = [
  {
    name: "valid_single_secret",
    why: "The ordinary delivery.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "valid_rotation_receiver_holds_new_only",
    why: "The receiver already swapped. The first v1 matches.",
    body: BATCH_BODY,
    header: ROTATION,
    secrets: [NEW_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "valid_rotation_receiver_holds_old_only",
    why: "The whole point of the window: a receiver that has not swapped yet keeps taking delivery. A verifier that reads only the LAST v1 would also pass here, which is why the next case exists.",
    body: BATCH_BODY,
    header: ROTATION,
    secrets: [OLD_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "valid_rotation_receiver_holds_both",
    why: "Mid-swap the receiver may hold both. Either match is a pass.",
    body: BATCH_BODY,
    header: ROTATION,
    secrets: [OLD_SECRET, NEW_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "valid_rotation_first_v1_matches_only",
    why: "The regression that motivated these helpers: a verifier keeping only the LAST v1 rejects every delivery to a receiver already on the new secret.",
    body: BATCH_BODY,
    header: sign([NEW_SECRET, OLD_SECRET], BATCH_BODY),
    secrets: [NEW_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "valid_at_tolerance_edge",
    why: "The window is inclusive: exactly at the tolerance still verifies.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    expected: "valid",
  },
  {
    name: "valid_custom_tolerance",
    why: "A receiver may tighten the window.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + 5,
    tolerance_seconds: 10,
    expected: "valid",
  },
  {
    name: "valid_unicode_body",
    why: "Exact bytes in, exact bytes hashed.",
    body: UNICODE_BODY,
    header: UNICODE,
    secrets: [NEW_SECRET],
    now_seconds: T + 10,
    expected: "valid",
  },
  {
    name: "invalid_signature_never_issued_secret",
    why: "A secret this sender never used matches no v1.",
    body: BATCH_BODY,
    header: ROTATION,
    secrets: [NEVER_ISSUED],
    now_seconds: T + 10,
    expected: "invalid_signature",
  },
  {
    name: "invalid_signature_tampered_body",
    why: "One byte changed in transit.",
    body: BATCH_BODY.replace("evt_1", "evt_9"),
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + 10,
    expected: "invalid_signature",
  },
  {
    name: "invalid_signature_rolled_off_secret",
    why: "Once the window closes the sender stops emitting the old v1, so the old secret stops verifying.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [OLD_SECRET],
    now_seconds: T + 10,
    expected: "invalid_signature",
  },
  {
    name: "stale_timestamp_in_the_past",
    why: "Past the window: a replay, or a receiver whose clock ran ahead.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 60,
    expected: "stale_timestamp",
  },
  {
    name: "stale_timestamp_in_the_future",
    why: "The window is symmetric, so a sender clock running ahead is caught too.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 60,
    expected: "stale_timestamp",
  },
  {
    name: "stale_timestamp_custom_tolerance",
    why: "A tightened window rejects what the default would have accepted.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEW_SECRET],
    now_seconds: T + 60,
    tolerance_seconds: 10,
    expected: "stale_timestamp",
  },
  {
    name: "stale_timestamp_beats_bad_signature",
    why: "Checks run in order, so a delivery that is both stale and wrongly signed reports the staleness.",
    body: BATCH_BODY,
    header: SINGLE,
    secrets: [NEVER_ISSUED],
    now_seconds: T + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 60,
    expected: "stale_timestamp",
  },
  {
    name: "malformed_header_missing_t",
    why: "No timestamp means no freshness check is possible.",
    body: BATCH_BODY,
    header: "v1=deadbeef",
    secrets: [NEW_SECRET],
    now_seconds: T,
    expected: "malformed_header",
  },
  {
    name: "malformed_header_missing_v1",
    why: "A timestamp on its own carries nothing to compare.",
    body: BATCH_BODY,
    header: `t=${T}`,
    secrets: [NEW_SECRET],
    now_seconds: T,
    expected: "malformed_header",
  },
  {
    name: "malformed_header_non_numeric_t",
    why: "A `t` that is not a number fails parsing rather than being coerced to an epoch.",
    body: BATCH_BODY,
    header: `t=not-a-number,v1=${"0".repeat(64)}`,
    secrets: [NEW_SECRET],
    now_seconds: T,
    expected: "malformed_header",
  },
  {
    name: "malformed_header_empty",
    why: "An absent header reaches the verifier as an empty string often enough to be worth pinning.",
    body: BATCH_BODY,
    header: "",
    secrets: [NEW_SECRET],
    now_seconds: T,
    expected: "malformed_header",
  },
  {
    name: "malformed_header_garbage",
    why: "Anything that is not the scheme is refused, not guessed at.",
    body: BATCH_BODY,
    header: "sha256=deadbeef",
    secrets: [NEW_SECRET],
    now_seconds: T,
    expected: "malformed_header",
  },
  {
    name: "malformed_header_beats_stale",
    why: "Malformed is reported first: there is no trustworthy timestamp to call stale.",
    body: BATCH_BODY,
    header: "v1=deadbeef",
    secrets: [NEW_SECRET],
    now_seconds: T + 100_000,
    expected: "malformed_header",
  },
];

export function buildVectors(): SignatureVectorFile {
  return {
    $schema_note:
      "Generated file. Do not hand-edit: run `pnpm run task generateWebhookSignatureVectors` from platform/app.",
    generated_by: "platform/app/src/tasks/generateWebhookSignatureVectors.ts",
    generated_from: "platform/app/src/server/webhooks/signature.ts",
    algorithm: {
      header: "X-LangWatch-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]",
      signed_payload:
        "`${timestamp}.${raw body}`, using the timestamp as parsed from `t`",
      digest: "HMAC-SHA256, lowercase hex, compared in constant time",
      repeated_v1:
        "During a secret rotation the header carries one v1 per valid secret, newest first. Verification passes when ANY (held secret, v1) pair matches.",
    },
    default_tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    signing: SIGNING_VECTORS,
    verification: VERIFICATION_VECTORS,
  };
}

/** Repo-root absolute path of the committed vector file. */
export function vectorsFilePath(): string {
  return path.join(__dirname, "../../../..", VECTORS_RELATIVE_PATH);
}

/** The exact bytes the task writes, so a drift check can compare strings. */
export function serializeVectors(): string {
  return `${JSON.stringify(buildVectors(), null, 2)}\n`;
}

export default function generateWebhookSignatureVectors(): void {
  const target = vectorsFilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeVectors());
  console.log(`wrote ${target}`);
}
