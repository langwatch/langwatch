/**
 * Verification at ingest (ADR-183 §4): span admission marks a signed entry verified only on the
 * API key module's `verified` answer. Spec: modules/trace/specs/signed-calls.feature
 */
import { createHmac } from "node:crypto";

import {
  braidSignatureMessage,
  parseBraidSignature,
  type BraidSignatureVerdict,
  type VerifyBraidSignatureInput,
} from "@langwatch/api-key-contract";
import { VERIFIED_ATTRIBUTE_PREFIX } from "@langwatch/authorization";
import { createTenantId, type Command } from "@langwatch/eventing";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { RECORD_SPAN_COMMAND_TYPE, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { SpanSignatureVerificationService } from "../../features/span/services/span-signature-verification.service.ts";
import { EventingRecordSpanAdapter } from "../record-span.commands.ts";

const ORG = "org-1";
const TRACE = "0af7651916cd43dd8448eb211c80319c";
const OTHER_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const MARK = `${VERIFIED_ATTRIBUTE_PREFIX}orchestrator`;

type SigningKey = {
  organizationId: string;
  projectId: string;
  publicId: string;
  secret: string;
  revoked: boolean;
};

const orchestratorKey: SigningKey = {
  organizationId: ORG,
  projectId: "orchestrator",
  publicId: "orchkey1",
  secret: "orchestrator-secret",
  revoked: false,
};

function hmacOf({ key, text }: { key: SigningKey; text: string }): string {
  return createHmac("sha256", `lwsk_${key.publicId}_${key.secret}`)
    .update(text, "utf8")
    .digest("base64url");
}

/** Signs as the SDK does: wire format v1 over the trace id and the sorted entries. */
function sign({
  key,
  traceId,
  entries,
}: {
  key: SigningKey;
  traceId: string;
  entries: Record<string, string>;
}): string {
  const message = braidSignatureMessage({ traceId, entries });
  if (message.kind !== "message") throw new Error("entries the wire format never signs");
  const envelope = {
    v: 1,
    kid: key.publicId,
    keys: Object.keys(entries).toSorted(),
    sig: hmacOf({ key, text: message.text }),
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

/** An honest stand-in for `ApiKeyApi.verifyBraidSignature` over the keys it holds. */
function keyDirectory(keys: SigningKey[]) {
  const asked: VerifyBraidSignatureInput[] = [];
  const verifyBraidSignature = async (
    input: VerifyBraidSignatureInput,
  ): Promise<BraidSignatureVerdict> => {
    asked.push(input);
    const signature = parseBraidSignature({ attribute: input.signature });
    if (!signature) return { outcome: "failed", reason: "malformed" };
    const key = keys.find(
      (held) => held.organizationId === input.organizationId && held.publicId === signature.kid,
    );
    if (!key) return { outcome: "failed", reason: "unknown_key", publicId: signature.kid };
    if (key.revoked) return { outcome: "failed", reason: "revoked", publicId: key.publicId };
    const signed: Record<string, string> = {};
    for (const entry of signature.keys) {
      const value = input.entries[entry];
      if (value === undefined) return { outcome: "failed", reason: "malformed" };
      signed[entry] = value;
    }
    const message = braidSignatureMessage({ traceId: input.traceId, entries: signed });
    if (message.kind !== "message") return { outcome: "failed", reason: "malformed" };
    return hmacOf({ key, text: message.text }) === signature.sig
      ? { outcome: "verified", signingProjectId: key.projectId, keys: signature.keys }
      : { outcome: "failed", reason: "bad_signature", publicId: key.publicId };
  };
  return { asked, verifyBraidSignature };
}

const projects = {
  findIdentity: async (id: string): Promise<ProjectIdentity | null> => ({
    id,
    name: id,
    slug: id,
    teamId: "team-1",
    organizationId: ORG,
    isPersonal: false,
    ownerUserId: null,
    kind: "application",
  }),
};

function span({
  traceId = TRACE,
  attributes,
}: {
  traceId?: string;
  attributes: Record<string, string>;
}): OtlpSpan {
  return {
    traceId,
    spanId: "span-1",
    name: "specialist call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: Object.entries(attributes).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    })),
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function commandFor({
  projectId = "specialists",
  sent,
}: {
  projectId?: string;
  sent: OtlpSpan;
}): Command<RecordSpanCommandData> {
  return {
    tenantId: createTenantId(projectId),
    aggregateId: sent.traceId,
    type: RECORD_SPAN_COMMAND_TYPE,
    data: {
      tenantId: projectId,
      span: sent,
      resource: { attributes: [] },
      instrumentationScope: null,
      occurredAt: Date.now(),
    },
  };
}

function admission({
  signatures,
  timeoutMs,
}: {
  signatures: ReturnType<typeof keyDirectory> | { verifyBraidSignature: () => Promise<never> };
  timeoutMs?: number;
}) {
  return EventingRecordSpanAdapter.create({
    piiRedaction: { redact: async () => undefined },
    costEnrichment: { enrich: async () => undefined },
    tokenEstimation: { estimate: async () => undefined },
    contentDrop: { drop: async () => ({ droppedCount: 0, droppedCategories: [] }) },
    signatures: SpanSignatureVerificationService.create({
      signatures,
      projects,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
  });
}

async function storedAttributes({
  handler,
  command,
}: {
  handler: EventingRecordSpanAdapter;
  command: Command<RecordSpanCommandData>;
}): Promise<Record<string, string | null | undefined>> {
  const [event] = await handler.handle(command);
  if (!event) throw new Error("the span was refused");
  return Object.fromEntries(
    event.data.span.attributes.map((attribute) => [attribute.key, attribute.value.stringValue]),
  );
}

const signedWeb = (traceId = TRACE) =>
  sign({ key: orchestratorKey, traceId, entries: { orchestrator: "web" } });

describe("span admission for signed calls", () => {
  describe("given a span carrying a valid signature", () => {
    /** @scenario "A span carrying a valid signature is marked verified" */
    it("marks the signed entry verified by the signing project", async () => {
      const directory = keyDirectory([orchestratorKey]);
      const sent = span({
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb() },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: directory }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBe("orchestrator");
      expect(directory.asked).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          traceId: TRACE,
          entries: { orchestrator: "web" },
        }),
      ]);
    });

    /** @scenario "A signed entry stays verified down the call chain within its trace" */
    it("marks it verified in a third project the call chain reached within the trace", async () => {
      const sent = span({
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb() },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: keyDirectory([orchestratorKey]) }),
        command: commandFor({ projectId: "search", sent }),
      });

      expect(stored[MARK]).toBe("orchestrator");
    });
  });

  describe("given a signature that does not hold for the span", () => {
    /** @scenario "A signature made in one trace does not verify in another" */
    it("stores a span replaying another trace's signature without a mark", async () => {
      const sent = span({
        traceId: OTHER_TRACE,
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb(TRACE) },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: keyDirectory([orchestratorKey]) }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
      expect(stored.orchestrator).toBe("web");
    });

    /** @scenario "A signed entry with a changed value does not verify" */
    it("stores a span whose signed entry changed without a mark", async () => {
      const sent = span({
        attributes: { orchestrator: "app", "langwatch.signature": signedWeb() },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: keyDirectory([orchestratorKey]) }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
    });

    /** @scenario "A signing key is only looked up inside the span's own organisation" */
    it("looks the key up in the span's organisation, where another organisation's key is unknown", async () => {
      const elsewhere = { ...orchestratorKey, organizationId: "org-2" };
      const directory = keyDirectory([elsewhere]);
      const sent = span({
        attributes: {
          orchestrator: "web",
          "langwatch.signature": sign({
            key: elsewhere,
            traceId: TRACE,
            entries: { orchestrator: "web" },
          }),
        },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: directory }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
      expect(directory.asked.map((input) => input.organizationId)).toEqual([ORG]);
    });

    /** @scenario "A revoked key stops verifying within a minute" */
    it("stores a span signed with a key the API key module answers revoked without a mark", async () => {
      const sent = span({
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb() },
      });

      const stored = await storedAttributes({
        handler: admission({ signatures: keyDirectory([{ ...orchestratorKey, revoked: true }]) }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
    });
  });

  describe("given a client sending its own verified mark", () => {
    /** @scenario "A client cannot send its own verified mark" */
    it("removes the forged mark from the span, its resource and events, and keeps only an earned one", async () => {
      const sent = span({
        attributes: {
          [MARK]: "orchestrator",
          [`${VERIFIED_ATTRIBUTE_PREFIX}tier`]: "orchestrator",
          orchestrator: "web",
          "langwatch.signature": signedWeb(),
        },
      });
      sent.events = [
        {
          timeUnixNano: { low: 0, high: 0 },
          name: "forged",
          attributes: [{ key: MARK, value: { stringValue: "orchestrator" } }],
          droppedAttributesCount: 0,
        },
      ];
      const command = commandFor({ sent });
      command.data.resource = { attributes: [{ key: MARK, value: { stringValue: "x" } }] };

      const [event] = await admission({ signatures: keyDirectory([orchestratorKey]) }).handle(
        command,
      );

      const marks = event!.data.span.attributes.filter((attribute) =>
        attribute.key.startsWith(VERIFIED_ATTRIBUTE_PREFIX),
      );
      expect(marks).toEqual([{ key: MARK, value: { stringValue: "orchestrator" } }]);
      expect(event!.data.span.events[0]!.attributes).toEqual([]);
      expect(event!.data.resource!.attributes).toEqual([]);
    });

    it("never lists the verified prefix among the reserved attributes clients may send", () => {
      const passthrough = [...EventingRecordSpanAdapter.RESERVED_ATTRIBUTE_PASSTHROUGH];

      expect(passthrough.some((key) => key.startsWith(VERIFIED_ATTRIBUTE_PREFIX))).toBe(false);
    });
  });

  describe("given a key lookup that cannot run", () => {
    /** @scenario "A key lookup that cannot run leaves the span unverified, not refused" */
    it("admits the span unverified when the lookup throws", async () => {
      const sent = span({
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb() },
      });
      const failing = {
        verifyBraidSignature: () => Promise.reject(new Error("api key store down")),
      };

      const stored = await storedAttributes({
        handler: admission({ signatures: failing }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
      expect(stored.orchestrator).toBe("web");
    });

    it("admits the span unverified when the lookup does not answer in time", async () => {
      const sent = span({
        attributes: { orchestrator: "web", "langwatch.signature": signedWeb() },
      });
      const hanging = { verifyBraidSignature: () => new Promise<never>(() => undefined) };

      const stored = await storedAttributes({
        handler: admission({ signatures: hanging, timeoutMs: 5 }),
        command: commandFor({ sent }),
      });

      expect(stored[MARK]).toBeUndefined();
    });
  });

  describe("given a span with no signature", () => {
    it("asks the API key module nothing", async () => {
      const directory = keyDirectory([orchestratorKey]);

      const stored = await storedAttributes({
        handler: admission({ signatures: directory }),
        command: commandFor({ sent: span({ attributes: { orchestrator: "web" } }) }),
      });

      expect(directory.asked).toEqual([]);
      expect(stored[MARK]).toBeUndefined();
    });
  });
});
