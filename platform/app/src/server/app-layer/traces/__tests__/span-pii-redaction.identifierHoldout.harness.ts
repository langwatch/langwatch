/**
 * The fixtures and the service harness the identifier hold-out suites share.
 *
 * Two suites read this: one asserts what the reserved names and the opaque-value
 * rule KEEP, the other asserts what still reaches the analysis service. They are
 * one behaviour seen from two sides, so they share a corpus generator and a
 * service builder rather than two that could drift apart.
 *
 * The `vi.mock` calls stay in the suites: those are hoisted per module, so a
 * mock declared here would not apply to the file importing it.
 */

import { vi } from "vitest";
import {
  EMPTY_AUDIENCE,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type {
  OtlpKeyValue,
  OtlpResource,
  OtlpSpan,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  type BatchClearPIIFunction,
  type DataPrivacyResolver,
  OtlpSpanPiiRedactionService,
} from "../span-pii-redaction.service";

export const TENANT = createTenantId("project-web-app");

export const STRICT_POLICY: ResolvedDataPrivacy = {
  categories: {
    input: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    output: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    system: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    tools: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
  },
  pii: { level: "strict", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  customAttributes: [],
};

export function resolverFor(policy: ResolvedDataPrivacy): DataPrivacyResolver {
  return { getResolvedForProject: async () => policy };
}

/**
 * A redaction service whose only mocked seam is the analysis call, so the rest
 * of the stack runs for real. Returns the service, the spy, and `submitted()` —
 * every string that left the process, flattened across batches, which is the
 * observable contract these suites assert against.
 */
export function makeService(policy: ResolvedDataPrivacy = STRICT_POLICY) {
  // Return null for every input: the analysis service reporting "nothing to
  // change" keeps the stored values readable, so an assertion about what was
  // STORED and one about what was SUBMITTED cannot be confused for each other.
  const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) =>
    texts.map(() => null),
  );
  const service = new OtlpSpanPiiRedactionService({
    batchClearPII: batchSpy,
    isLangevalsConfigured: true,
    isProduction: false,
    dataPrivacyResolver: resolverFor(policy),
  });
  const submitted = (): string[] =>
    batchSpy.mock.calls.flatMap((call) => call[0] as string[]);
  return { service, batchSpy, submitted };
}

export function spanWith(attributes: Record<string, string>): OtlpSpan {
  const attrs: OtlpKeyValue[] = Object.entries(attributes).map(
    ([key, value]) => ({ key, value: { stringValue: value } }),
  );
  return {
    traceId: "abc123",
    spanId: "def456",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: attrs,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

export function attr(span: OtlpSpan, key: string): string | undefined {
  return (
    span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined
  );
}

export function resourceAttr(
  resource: OtlpResource | null,
  key: string,
): string | undefined {
  return (
    resource?.attributes.find((a) => a.key === key)?.value.stringValue ??
    undefined
  );
}

/** A seeded generator, so a failing corpus names the same values on a re-run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(
  next: () => number,
  alphabet: string,
  length: number,
): string {
  return Array.from(
    { length },
    () => alphabet[Math.floor(next() * alphabet.length)]!,
  ).join("");
}

export const HEX = "0123456789abcdef";
export const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
export const DIGITS = "0123456789";

/**
 * A decimal trace identifier that a phone detector claims: a leading 1 and ten
 * more digits is the international shape of a North American number, and a
 * decimal identifier carries nothing that says otherwise.
 *
 * This is the fixture the reserved-name catalog is worth testing with. Across
 * the decimal widths a bridge mints -- ten, twelve, thirteen, nineteen, twenty
 * and thirty-two digits -- the reserved name changes the stored value in no
 * other case, because every remaining digit recognizer either needs a context
 * word next to the number or needs a payment-card checksum inside an issuer
 * range. A test built on any of those widths passes with the catalog deleted
 * and proves nothing. This one goes red.
 *
 * Generated from the suite's seed like every other identifier here, never
 * observed in traffic.
 */
export const DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER = `1${pick(
  seededRandom(20260912),
  DIGITS,
  10,
)}`;

/**
 * The shapes an OTel pipeline actually emits, split by what the rule can
 * promise about each. Trace ids and uuids — long enough that the rule holds them back for every
 * value rather than merely for most. A run qualifies as hex only if it also
 * carries a letter, since a run of nothing but digits is a card or an account
 * number as far as this rule can tell; across thirty-two hex characters a draw
 * with no letter at all happens about three times in ten million, so a leak
 * here is a broken rule rather than an unlucky draw.
 */
export function unconditionalCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const corpus: string[] = [];
  for (let i = 0; i < 300; i++) {
    corpus.push(pick(next, HEX, 32));
    corpus.push(
      `${pick(next, HEX, 8)}-${pick(next, HEX, 4)}-4${pick(next, HEX, 3)}-a${pick(next, HEX, 3)}-${pick(next, HEX, 12)}`,
    );
  }
  return corpus;
}

/**
 * The short tokens, which clear the rule on a coin toss rather than on their
 * shape: a sixteen-character span id drawn with no letter at all (about one in
 * eighteen hundred) reads as a digit run, and a ULID qualifies on carrying two
 * digits rather than on being hex. Both are submitted when the draw goes that
 * way, so the assertion below is a rate and not a zero — an exact zero would be
 * true of one seed and would claim something the rule does not deliver.
 */
export function shortTokenCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const corpus: string[] = [];
  for (let i = 0; i < 600; i++) {
    corpus.push(pick(next, HEX, 16));
    corpus.push(`session_${pick(next, CROCKFORD, 26)}`);
  }
  return corpus;
}

export const NAME_PARTS = [
  "Jean",
  "Claude",
  "Anne",
  "Marie",
  "Maria",
  "Schmidt",
  "Wolfgang",
  "Amadeus",
  "Mozart",
  "Gonzalez",
  "Rodriguez",
  "Saint",
  "Baptiste",
  "Johansson",
  "Pierre",
  "Dupont",
];

/**
 * Personal names in the forms that have no space to save them: hyphenated,
 * dotted, and run together. This is the direction that regressed once, when the
 * analysis path borrowed the native engine's shape rule, so it is generated
 * rather than hand-picked.
 */
export function nameCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const names: string[] = [];
  while (names.length < 2000) {
    const parts = 2 + Math.floor(next() * 3);
    const picked = Array.from(
      { length: parts },
      () => NAME_PARTS[Math.floor(next() * NAME_PARTS.length)]!,
    );
    const separator = [" ", "-", ".", ""][Math.floor(next() * 4)]!;
    names.push(picked.join(separator));
  }
  return names;
}
