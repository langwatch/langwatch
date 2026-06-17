import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_AUDIENCE,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type {
  OtlpKeyValue,
  OtlpSpan,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  type BatchClearPIIFunction,
  type DataPrivacyResolver,
  OtlpSpanPiiRedactionService,
} from "../span-pii-redaction.service";

// The PII analysis service is the one true external boundary; everything else
// (the redaction engines, the routing) is exercised for real. The feature flag
// resolves to its default so the strict path reaches the batch deterministically.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => false) },
}));

const TENANT = "project-web-app";

function mkPolicy({
  piiLevel = "essential" as PiiLevel,
  piiEntities = [] as string[],
  secretsEnabled = true,
  customPatterns = [] as string[],
}): ResolvedDataPrivacy {
  const cat = () => ({
    disposition: "capture" as const,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: { level: piiLevel, entities: piiEntities },
    secrets: { enabled: secretsEnabled, customPatterns },
    customAttributes: [],
  };
}

function resolverFor(policy: ResolvedDataPrivacy): DataPrivacyResolver {
  return { getResolvedForProject: async () => policy };
}

function spanWith(attributes: Record<string, string>): OtlpSpan {
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

function attr(span: OtlpSpan, key: string): string | undefined {
  return (
    span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined
  );
}

function makeService(policy: ResolvedDataPrivacy) {
  const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) =>
    texts.map(() => "[REDACTED]"),
  );
  const service = new OtlpSpanPiiRedactionService({
    batchClearPII: batchSpy,
    isLangevalsConfigured: true,
    isProduction: false,
    dataPrivacyResolver: resolverFor(policy),
  });
  return { service, batchSpy };
}

describe("OtlpSpanPiiRedactionService scoped-policy native redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT;
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
      const { service, batchSpy } = makeService(
        mkPolicy({ piiLevel: "strict" }),
      );
      const span = spanWith({ input: "My name is Alexander Hamilton." });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(attr(span, "input")).toBe("[REDACTED]");
    });

    /** @scenario Strict falls back to the native essential floor when the analysis service is unavailable */
    it("still redacts essential PII natively when the analysis service is unavailable", async () => {
      const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) =>
        texts.map(() => "[REDACTED]"),
      );
      // isLangevalsConfigured: false + not production -> buildOptions returns
      // null, so the strict batch is never sent. The native floor is all that
      // runs, and it must still scrub the pattern-based entities.
      const service = new OtlpSpanPiiRedactionService({
        batchClearPII: batchSpy,
        isLangevalsConfigured: false,
        isProduction: false,
        dataPrivacyResolver: resolverFor(mkPolicy({ piiLevel: "strict" })),
      });
      const span = spanWith({
        input:
          "email jane@example.com card 4242424242424242 name Alexander Hamilton",
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
      const { service, batchSpy } = makeService(
        mkPolicy({ piiLevel: "disabled" }),
      );
      const span = spanWith({ input: "contact jane@example.com please" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toContain("jane@example.com");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given the essential level and a Brazilian CPF", () => {
    /** @scenario A Brazilian CPF is redacted at the essential level */
    it("redacts the CPF natively with no analysis-service call", async () => {
      const { service, batchSpy } = makeService(mkPolicy({}));
      const span = spanWith({ input: "cpf 529.982.247-25 done" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "input")).toBe("cpf [BR_CPF] done");
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given a custom PII level", () => {
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
});
