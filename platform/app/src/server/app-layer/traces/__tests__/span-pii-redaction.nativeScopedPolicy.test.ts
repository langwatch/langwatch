import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";

import {
  EMPTY_AUDIENCE,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type { OtlpKeyValue, OtlpSpan } from "@langwatch/trace-contract";
import {
  type BatchClearPIIFunction,
  OtlpSpanPiiRedactionService,
} from "../span-pii-redaction.service";

import { createTenantId } from "@langwatch/eventing";
import { DataPrivacyServiceFake } from "./data-privacy.service.fake";

const TENANT = createTenantId("project-web-app");

function mkPolicy({
  piiLevel = "essential" as PiiLevel,
  piiEntities = [] as string[],
  piiExceptPatterns = [] as string[],
  secretsEnabled = true,
  customPatterns = [] as string[],
}): ResolvedDataPrivacy {
  const cat = () => ({
    disposition: "capture" as const,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: {
      level: piiLevel,
      entities: piiEntities,
      exceptPatterns: piiExceptPatterns,
    },
    secrets: { enabled: secretsEnabled, customPatterns },
    customAttributes: [],
  };
}

function resolverFor(policy: ResolvedDataPrivacy) {
  return new DataPrivacyServiceFake(policy);
}

function transportFor(batch: BatchClearPIIFunction) {
  return {
    clearGoogleDlp: async ({ text }: { text: string }) => (await batch([text]))[0] ?? null,
    clearPresidio: async (
      texts: string[],
      piiRedactionLevel: "ESSENTIAL" | "STRICT" | "DISABLED",
      entities?: readonly string[],
    ) =>
      await batch(texts, {
        piiRedactionLevel,
        mainMethod: "presidio",
        ...(entities ? { entities } : {}),
      }),
    close: async () => undefined,
  };
}

function spanWith(attributes: Record<string, string>): OtlpSpan {
  const attrs: OtlpKeyValue[] = Object.entries(attributes).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
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

function attr(span: OtlpSpan, key: string): string | undefined {
  return span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined;
}

function makeService(policy: ResolvedDataPrivacy) {
  const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) => texts.map(() => "[REDACTED]"));
  const service = new OtlpSpanPiiRedactionService({
    transport: transportFor(batchSpy),
    isLangevalsConfigured: true,
    isProduction: false,
    nativePolicyEnforced: true,
    piiRedactionMaxAttributeLength: 250_000,
    dataPrivacy: resolverFor(policy),
  });
  return { service, batchSpy };
}

describe("OtlpSpanPiiRedactionService scoped-policy native redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the default policy (essential PII, secrets on)", () => {
    /** @scenario A leaked provider API key is redacted with no configuration */
    it("redacts a leaked modern OpenAI project key natively with no analysis-service call", async () => {
      const { service, batchSpy } = makeService(PLATFORM_DEFAULT_DATA_PRIVACY);
      // Modern base64url key: `_` and `-` mid-body, no inner word boundary.
      const key = "sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xYaB-cD_eF";
      const span = spanWith({ input: `my key is ${key} thanks` });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).not.toContain(key);
      expect(attr(span, "input")).not.toContain("sk-proj-");
      expect(attr(span, "input")).toContain("[SECRET]");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario A database connection string is redacted */
    it("redacts the password in a postgres connection string, keeping the host", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({
        input: "db is postgres://app:s3cr3tpw@db.acme.internal:5432/main",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      const value = attr(span, "input")!;
      expect(value).not.toContain("s3cr3tpw");
      expect(value).toContain("[SECRET]");
      expect(value).toContain("db.acme.internal");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario A value under an obviously-sensitive attribute name is redacted */
    it("redacts the value of an authorization attribute by its name", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({ authorization: "Bearer abc123def456ghi789" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "authorization")).toBe("[SECRET]");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario Secrets redaction leaves ordinary text intact */
    it("leaves an ordinary sentence unchanged", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const text = "The quick brown fox jumps over the lazy dog.";
      const span = spanWith({ input: text });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toBe(text);
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given a custom secret pattern", () => {
    /** @scenario A custom pattern redacts a company-specific secret */
    it("redacts a token matching the custom pattern", async () => {
      const policy = mkPolicy({ customPatterns: ["acme_live_[a-z0-9]{8,}"] });
      const { service, batchSpy } = makeService(policy);
      const span = spanWith({ input: "token acme_live_abcd1234 end" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toBe("token [SECRET] end");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given secrets redaction turned off", () => {
    /** @scenario A team can disable secrets redaction on purpose */
    it("leaves an API key in place", async () => {
      const policy = mkPolicy({ secretsEnabled: false });
      const { service, batchSpy } = makeService(policy);
      const key = "sk-" + "B".repeat(40);
      const span = spanWith({ input: `key ${key}` });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toContain(key);
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given the essential PII level", () => {
    /** @scenario Essential PII is redacted natively without calling the analysis service */
    it("redacts an email and a phone number with no analysis-service call", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({
        input: "reach me at jane@example.com or +14155552671 anytime",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      const value = attr(span, "input")!;
      expect(value).not.toContain("jane@example.com");
      expect(value).not.toContain("4155552671");
      expect(value).toContain("[EMAIL_ADDRESS]");
      expect(value).toContain("[PHONE_NUMBER]");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario Essential level leaves names untouched */
    it("keeps a person's name", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({ input: "My name is Alexander Hamilton." });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toContain("Alexander Hamilton");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    it("keeps a datestamped identifier attribute whole and still redacts a phone number in text", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({
        "deployment.name": "hosted-eu-20260812-09",
        input: "ref 2026081209 checkpoint",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "deployment.name")).toBe("hosted-eu-20260812-09");
      expect(attr(span, "input")).toBe("ref [PHONE_NUMBER] checkpoint");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario A credit card number is validated before being redacted */
    it("redacts a Luhn-valid card but keeps a random 16-digit order id", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({
        input: "card 4242424242424242 order 1234567890123456",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      const value = attr(span, "input")!;
      expect(value).not.toContain("4242424242424242");
      expect(value).toContain("1234567890123456");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given the strict PII level", () => {
    /** @scenario Strict level redacts names using the analysis service */
    it("sends content to the analysis-service batch", async () => {
      const { service, batchSpy } = makeService(mkPolicy({ piiLevel: "strict" }));
      const span = spanWith({ input: "My name is Alexander Hamilton." });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(attr(span, "input")).toBe("[REDACTED]");
    });

    /** @scenario Strict falls back to the native essential floor when the analysis service is unavailable */
    it("still redacts essential PII natively when the analysis service is unavailable", async () => {
      const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) => texts.map(() => "[REDACTED]"));
      // isLangevalsConfigured: false + not production -> buildOptions returns
      // null, so the strict batch is never sent. The native floor is all that
      // runs, and it must still scrub the pattern-based entities.
      const service = new OtlpSpanPiiRedactionService({
        transport: transportFor(batchSpy),
        isLangevalsConfigured: false,
        isProduction: false,
        nativePolicyEnforced: true,
        piiRedactionMaxAttributeLength: 250_000,
        dataPrivacy: resolverFor(mkPolicy({ piiLevel: "strict" })),
      });
      const span = spanWith({
        input: "email jane@example.com card 4242424242424242 name Alexander Hamilton",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      const value = attr(span, "input")!;
      expect(value).not.toContain("jane@example.com");
      expect(value).not.toContain("4242424242424242");
      expect(value).toContain("[EMAIL_ADDRESS]");
      // Names need the analysis service, which is down, so they remain.
      expect(value).toContain("Alexander Hamilton");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given PII redaction disabled", () => {
    /** @scenario Disabling PII keeps personal data */
    it("keeps an email address while secrets stay scrubbed", async () => {
      const { service, batchSpy } = makeService(mkPolicy({ piiLevel: "disabled" }));
      const span = spanWith({ input: "contact jane@example.com please" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toContain("jane@example.com");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the essential level processes a Brazilian CPF", () => {
    /** @scenario A Brazilian CPF is redacted at the essential level */
    it("redacts the CPF natively with no analysis-service call", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({ input: "cpf 529.982.247-25 done" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toBe("cpf [BR_CPF] done");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a custom PII level is configured", () => {
    /** @scenario A custom level redacts only the selected identifiers natively */
    it("redacts only the selected native identifiers, leaving the rest, with no analysis-service call", async () => {
      const { service, batchSpy } = makeService(
        mkPolicy({
          piiLevel: "custom",
          piiEntities: ["EMAIL_ADDRESS", "BR_CPF"],
        }),
      );
      const span = spanWith({
        input: "mail jane@example.com cpf 529.982.247-25 card 4111111111111111",
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      const value = attr(span, "input")!;
      expect(value).toContain("[EMAIL_ADDRESS]");
      expect(value).toContain("[BR_CPF]");
      // The card was not selected, so it is left intact.
      expect(value).toContain("4111111111111111");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    /** @scenario A custom level reaches the analysis service only for the identifiers that need it */
    it("sends only the selected analysis-service identifiers to the batch", async () => {
      const { service, batchSpy } = makeService(
        mkPolicy({ piiLevel: "custom", piiEntities: ["PERSON"] }),
      );
      const span = spanWith({ input: "My name is Alexander Hamilton." });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy.mock.calls[0]![1].entities).toEqual(["PERSON"]);
    });

    it("does not call the analysis service when only native identifiers are selected", async () => {
      const { service, batchSpy } = makeService(
        mkPolicy({ piiLevel: "custom", piiEntities: ["EMAIL_ADDRESS"] }),
      );
      const span = spanWith({ input: "mail jane@example.com" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toContain("[EMAIL_ADDRESS]");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given strict PII and the analysis service cannot run", () => {
    const PII_INCOMPLETE = "langwatch.privacy.pii_incomplete";

    function strictService({
      isLangevalsConfigured,
      isProduction,
      batchClearPII,
    }: {
      isLangevalsConfigured: boolean;
      isProduction: boolean;
      batchClearPII: BatchClearPIIFunction;
    }) {
      return new OtlpSpanPiiRedactionService({
        transport: transportFor(batchClearPII),
        isLangevalsConfigured,
        isProduction,
        nativePolicyEnforced: true,
        piiRedactionMaxAttributeLength: 250_000,
        dataPrivacy: resolverFor(mkPolicy({ piiLevel: "strict" })),
        featureFlags: MemoryFeatureFlagService.create(),
      });
    }

    /** @scenario An incomplete strict redaction is marked on the trace */
    it("marks the span incomplete when the analysis service is not configured", async () => {
      const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) => texts.map(() => "[REDACTED]"));
      const service = strictService({
        isLangevalsConfigured: false,
        isProduction: false,
        batchClearPII: batchSpy,
      });
      const span = spanWith({ input: "mail a@b.com, I am John from New York" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      // The native floor still scrubbed the email, but names/locations slip
      // through, so the span is marked rather than presented as fully scrubbed.
      expect(attr(span, "input")).not.toContain("a@b.com");
      expect(attr(span, PII_INCOMPLETE)).toBe("strict");
      expect(batchSpy).not.toHaveBeenCalled();
    });

    it("keeps the native floor and marks the span when the analysis service errors", async () => {
      const batchSpy = vi.fn<BatchClearPIIFunction>(async () => {
        throw new Error("503 service unavailable");
      });
      const service = strictService({
        isLangevalsConfigured: true,
        isProduction: false,
        batchClearPII: batchSpy,
      });
      const span = spanWith({ input: "mail a@b.com" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(attr(span, "input")).not.toContain("a@b.com");
      expect(attr(span, PII_INCOMPLETE)).toBe("strict");
      expect(batchSpy).toHaveBeenCalled();
    });

    it("does not mark the span when PII redaction is intentionally disabled by the kill switch", async () => {
      // The strict-PII analysis kill switch is on, so buildOptions returns null
      // even though langevals is configured. That is a deliberate opt-out, not an
      // outage, so the incomplete marker must NOT show.
      const featureFlags = MemoryFeatureFlagService.create();
      featureFlags.setFlag("ops_pii_strict_presidio_redaction_disabled", true);
      const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) => texts.map(() => "[REDACTED]"));
      const service = new OtlpSpanPiiRedactionService({
        isLangevalsConfigured: true,
        isProduction: false,
        transport: transportFor(batchSpy),
        nativePolicyEnforced: true,
        piiRedactionMaxAttributeLength: 250_000,
        dataPrivacy: resolverFor(mkPolicy({ piiLevel: "strict" })),
        featureFlags,
      });
      const span = spanWith({ input: "mail a@b.com, I am John from New York" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(attr(span, PII_INCOMPLETE)).toBeUndefined();
      expect(batchSpy).not.toHaveBeenCalled();
    });

    it("re-throws in production so the span is blocked rather than stored unredacted", async () => {
      const batchSpy = vi.fn<BatchClearPIIFunction>(async () => {
        throw new Error("503 service unavailable");
      });
      const service = strictService({
        isLangevalsConfigured: true,
        isProduction: true,
        batchClearPII: batchSpy,
      });
      const span = spanWith({ input: "mail a@b.com" });

      await expect(service.redactSpan(span, null, "STRICT", TENANT)).rejects.toThrow();
      expect(attr(span, PII_INCOMPLETE)).toBeUndefined();
    });
  });
});

describe("OtlpSpanPiiRedactionService PII exception patterns", () => {
  describe("given an essential policy with an exception for a business number format", () => {
    /** @scenario An exception pattern keeps a business identifier while other PII is still redacted */
    it("keeps the excepted number and still redacts the email next to it", async () => {
      const { service } = makeService(mkPolicy({ piiExceptPatterns: ["00\\d{12}"] }));
      const span = spanWith({
        "gen_ai.prompt": "reservation 00528000043000 for test@example.com",
      });
      await service.redactSpan(span, null, "ESSENTIAL", TENANT);
      expect(attr(span, "gen_ai.prompt")).toBe("reservation 00528000043000 for [EMAIL_ADDRESS]");
    });
  });

  describe("given a strict policy with exceptions", () => {
    /** @scenario Exceptions hold at the strict level */
    it("scopes the analysis batch to strict-only entities and forwards the exceptions", async () => {
      const { service, batchSpy } = makeService(
        mkPolicy({ piiLevel: "strict", piiExceptPatterns: ["00\\d{12}"] }),
      );
      const span = spanWith({
        "gen_ai.prompt": "reservation 00528000043000 here",
      });
      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(batchSpy).toHaveBeenCalledTimes(1);
      const options = batchSpy.mock.calls[0]![1];
      expect(options.entities).toBeDefined();
      expect(options.entities).not.toContain("CREDIT_CARD");
      expect(options.entities).toContain("PERSON");
      // Presidio receives only its supported entity selection; policy
      // exceptions remain on the native DLP-capable fallback path.
    });
  });

  describe("given a strict policy without exceptions", () => {
    it("keeps the full strict entity list for the analysis batch", async () => {
      const { service, batchSpy } = makeService(mkPolicy({ piiLevel: "strict" }));
      const span = spanWith({ "gen_ai.prompt": "hello there" });
      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(batchSpy).toHaveBeenCalledTimes(1);
      const options = batchSpy.mock.calls[0]![1];
      expect(options.entities).toBeUndefined();
      expect(options.exceptPatterns).toBeUndefined();
    });
  });
});

describe("OtlpSpanPiiRedactionService api key id attribute", () => {
  /** @scenario The receiver-written API key id stays readable */
  it("keeps the receiver-written key id readable", async () => {
    const { service } = makeService(mkPolicy({}));
    const span = spanWith({
      "langwatch.api_key.id": "key_abc123def456",
    });
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    expect(attr(span, "langwatch.api_key.id")).toBe("key_abc123def456");
  });

  /** @scenario Real key material under the API key id attribute is still redacted */
  it("scrubs actual key material under that attribute name", async () => {
    const { service } = makeService(mkPolicy({}));
    const span = spanWith({
      "langwatch.api_key.id": "sk-lw-" + "a".repeat(40),
    });
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    expect(attr(span, "langwatch.api_key.id")).toContain("[SECRET]");
    expect(attr(span, "langwatch.api_key.id")).not.toContain("sk-lw-");
  });

  // The exemption is scoped to this exact name. Everything else the
  // sensitive-name rule covers keeps being nuked, including neighbouring
  // api_key-shaped names that carry no receiver guarantee.
  it("still nukes other api_key-named attributes by name", async () => {
    const { service } = makeService(mkPolicy({}));
    const span = spanWith({ "user.api_key": "plain text value" });
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    expect(attr(span, "user.api_key")).toBe("[SECRET]");
  });

  it("nukes a near-miss name that only looks like the exempt one", async () => {
    const { service } = makeService(mkPolicy({}));
    const span = spanWith({ "langwatch.api_key.id.extra": "plain text value" });
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    expect(attr(span, "langwatch.api_key.id.extra")).toBe("[SECRET]");
  });
});

/**
 * The run id is how the pipeline attaches a trace to its simulation run. A
 * shape rule read it as a vendor key and wrote `[SECRET]` over it, so every
 * trace of every run in a project addressed the same wrong run, and the cost
 * of all of them landed on a run that never existed.
 */
describe("OtlpSpanPiiRedactionService scenario run id attribute", () => {
  /** @scenario "A simulation trace keeps the run id that links it to its run" */
  it("keeps the run id on the span it stores", async () => {
    const { service } = makeService(mkPolicy({}));
    const runId = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";
    const span = spanWith({ "scenario.run_id": runId });
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    expect(attr(span, "scenario.run_id")).toBe(runId);
  });
});

/**
 * The log and metric pipelines flatten a decoded OTLP tree into one record
 * keyed by a JSON path, because two attributes may share a name and each value
 * still needs its own address. A path can never satisfy a sensitive-NAME rule,
 * so before `attributeNames` those rules never fired here at all: an
 * `authorization` attribute was left to the value-shape rules, and a plain-text
 * one survived them. The name travels beside the path now.
 */
describe("OtlpSpanPiiRedactionService, given path-keyed log attributes", () => {
  const pathKeyed = () => ({
    body: "",
    attributes: {
      "log.0.value.stringValue": "key_abc123def456",
      "log.1.value.stringValue": "plain text value",
      "log.2.value.stringValue": "api_request",
    },
    resourceAttributes: {},
    attributeNames: {
      "log.0.value.stringValue": "langwatch.api_key.id",
      "log.1.value.stringValue": "authorization",
      "log.2.value.stringValue": "event.name",
    },
  });

  describe("when redactLog runs", () => {
    /** @scenario "A credential-named log attribute is redacted by name" */
    it("applies the sensitive-name rule to the attribute's real name", async () => {
      const { service } = makeService(mkPolicy({}));
      const log = pathKeyed();
      await service.redactLog(log, "ESSENTIAL", TENANT);
      expect(log.attributes["log.1.value.stringValue"]).toBe("[SECRET]");
    });

    /** @scenario "The receiver-written API key id survives redaction on the log path" */
    it("keeps the receiver-written key id readable, as on the span path", async () => {
      const { service } = makeService(mkPolicy({}));
      const log = pathKeyed();
      await service.redactLog(log, "ESSENTIAL", TENANT);
      expect(log.attributes["log.0.value.stringValue"]).toBe("key_abc123def456");
    });

    it("leaves an ordinary attribute alone", async () => {
      const { service } = makeService(mkPolicy({}));
      const log = pathKeyed();
      await service.redactLog(log, "ESSENTIAL", TENANT);
      expect(log.attributes["log.2.value.stringValue"]).toBe("api_request");
    });
  });

  describe("when no name is carried for a key", () => {
    it("falls back to the key itself", async () => {
      const { service } = makeService(mkPolicy({}));
      const log = {
        body: "",
        attributes: { authorization: "plain text value" },
        resourceAttributes: {},
      };
      await service.redactLog(log, "ESSENTIAL", TENANT);
      expect(log.attributes.authorization).toBe("[SECRET]");
    });
  });
});

/**
 * A resolved policy's PII exceptions are honored wherever the NATIVE pass
 * runs (secrets, and every essential-level entity, including under strict —
 * see the block above and applyContentRedaction.unit.test.ts). They are NOT
 * honored for the strict-only entities (names, locations) that only the
 * analysis-service batch can detect: buildOptions() always selects
 * mainMethod: "presidio", and the Presidio batch call has no parameter for
 * exceptions in the first place (it returns pre-anonymized text, not
 * positioned findings a veto could apply to — unlike the Google DLP path,
 * see maskDlpFindings in piiCheck.ts). This is a documented, tested contract,
 * not a bug: the UI tooltip in data-privacy.tsx and the doc-comment on
 * lambdaAfterNative both call it out.
 */
describe("OtlpSpanPiiRedactionService strict-only exception scoping", () => {
  function makeServiceWithRealBatch(policy: ResolvedDataPrivacy) {
    const presidio = vi.fn<BatchClearPIIFunction>();
    presidio.mockImplementation(async (texts) =>
      texts.map((text) => (text.includes("reservation") ? null : "[ANONYMIZED]")),
    );
    return new OtlpSpanPiiRedactionService({
      isLangevalsConfigured: true,
      isProduction: false,
      transport: transportFor(presidio),
      nativePolicyEnforced: true,
      piiRedactionMaxAttributeLength: 250_000,
      dataPrivacy: resolverFor(policy),
    });
  }

  it("still redacts a name/location match even when it fully matches an exception", async () => {
    const service = makeServiceWithRealBatch(
      mkPolicy({
        piiLevel: "strict",
        piiExceptPatterns: ["Acme Support Bot"],
      }),
    );
    const span = spanWith({ "conversation.text": "Acme Support Bot" });
    await service.redactSpan(span, null, "STRICT", TENANT);

    // The mock stands in for the real Presidio call: it always anonymizes,
    // exactly like the production endpoint, because exceptPatterns never
    // reaches it. The exception configured above does not save this value.
    expect(attr(span, "conversation.text")).toBe("[ANONYMIZED]");
  });

  it("still keeps a native essential-entity match under the same strict policy", async () => {
    const service = makeServiceWithRealBatch(
      mkPolicy({
        piiLevel: "strict",
        piiExceptPatterns: ["00[0-9]{12}"],
      }),
    );
    // A 14-digit string reads as a credit card to the native (essential)
    // recognizer, which strict runs first and which DOES honor exceptions.
    const span = spanWith({
      "conversation.text": "reservation 00528000043000 confirmed",
    });
    await service.redactSpan(span, null, "STRICT", TENANT);

    expect(attr(span, "conversation.text")).toBe("reservation 00528000043000 confirmed");
  });
});
