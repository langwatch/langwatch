import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  type DataPrivacyService,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { TenantId } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { type OtlpResource, type OtlpSpan } from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerTracePrivacyConfig } from "../../platform/config/worker.config";
import {
  createWorkerTracePrivacy,
  WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
} from "../worker-trace-privacy.composition";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so the application
 * still owns `RecordSpanCommand`'s adapters and nothing in this process
 * redacts a span. What has to be true today is that this composition root can
 * build the whole path — Trace's narrow port, the redaction service, the
 * native engines and the analysis transport — out of the four privacy
 * variables, the data-privacy service and the feature flags this process
 * already holds, and that a span carrying personal data comes out of it
 * scrubbed.
 *
 * It is driven through `TraceSpanPiiRedactionPort`, the port the conversion
 * will actually call, rather than through the service underneath it: a graph
 * that redacts correctly but cannot be handed to `RecordSpanCommand` would
 * pass a service-level test and still be unusable here.
 */

const TENANT = "project-1" as TenantId;

const config = (over: Partial<WorkerTracePrivacyConfig> = {}): WorkerTracePrivacyConfig => ({
  googleDlp: { disabled: true, credentials: undefined },
  presidio: { endpoint: "http://langevals", timeoutMs: 60_000 },
  isProduction: false,
  nativePolicyEnforced: true,
  ...over,
});

function policy(over: Partial<ResolvedDataPrivacy> = {}): ResolvedDataPrivacy {
  return {
    categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories },
    pii: { level: "essential", entities: [], exceptPatterns: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
    ...over,
  };
}

const dataPrivacyFor = (resolved: ResolvedDataPrivacy | null): DataPrivacyService =>
  ({
    getResolvedForProject: async () => {
      if (!resolved) throw new Error("no policy for this scope");
      return resolved;
    },
  }) as unknown as DataPrivacyService;

const flags: FeatureFlagService = { isEnabled: async () => false } as unknown as FeatureFlagService;

function span(attributes: { key: string; value: { stringValue: string } }[]): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm call",
    kind: 3,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

const valueOf = (subject: OtlpSpan, key: string): string | undefined =>
  subject.attributes.find((attribute) => attribute.key === key)?.value.stringValue ?? void 0;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const analyzerAnswering = (anonymized: string) =>
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => [{ status: "processed", raw_response: { anonymized } }],
  } as unknown as Response);

describe("given the privacy graph this process can compose", () => {
  /** @scenario "The privacy graph builds end to end from what the process already holds" */
  it("scrubs personal data out of a span without leaving the process", async () => {
    const privacy = createWorkerTracePrivacy({
      config: config(),
      dataPrivacy: dataPrivacyFor(policy()),
      featureFlags: flags,
    });
    const subject = span([
      { key: "langwatch.input", value: { stringValue: "write to ana@example.com" } },
    ]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "langwatch.input")).toBe("write to [EMAIL_ADDRESS]");
    expect(fetchMock).not.toHaveBeenCalled();
    await privacy.close();
  });

  /** @scenario "The floor covers every part of a span that carries text" */
  it("scrubs the resource attributes the same span carries", async () => {
    const privacy = createWorkerTracePrivacy({
      config: config(),
      dataPrivacy: dataPrivacyFor(policy()),
      featureFlags: flags,
    });
    const resource = {
      attributes: [{ key: "host.owner", value: { stringValue: "ana@example.com" } }],
      droppedAttributesCount: 0,
    } as unknown as OtlpResource;

    await privacy.spanRedactionPort().redact(span([]), resource, "ESSENTIAL", TENANT);

    expect(resource.attributes![0]!.value.stringValue).toBe("[EMAIL_ADDRESS]");
    await privacy.close();
  });

  /** @scenario "The strict level runs the floor first and escalates for the rest" */
  it("escalates to the analysis service at the strict level, after the native floor ran", async () => {
    analyzerAnswering("<PERSON> at [EMAIL_ADDRESS]");
    const privacy = createWorkerTracePrivacy({
      config: config(),
      dataPrivacy: dataPrivacyFor(
        policy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
      ),
      featureFlags: flags,
    });
    const subject = span([
      { key: "langwatch.input", value: { stringValue: "Ana Silva at ana@example.com" } },
    ]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sent.data).toEqual([{ input: "Ana Silva at [EMAIL_ADDRESS]" }]);
    expect(valueOf(subject, "langwatch.input")).toBe("[PERSON] at [EMAIL_ADDRESS]");
    await privacy.close();
  });

  /** @scenario "A credential named by its attribute is scrubbed whatever it looks like" */
  it("scrubs a credential under a sensitive attribute name while secrets redaction is on", async () => {
    const privacy = createWorkerTracePrivacy({
      config: config(),
      dataPrivacy: dataPrivacyFor(policy()),
      featureFlags: flags,
    });
    const subject = span([
      { key: "http.request.header.authorization", value: { stringValue: "plain-looking-value" } },
    ]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "http.request.header.authorization")).toBe("[SECRET]");
    await privacy.close();
  });

  /** @scenario "A record identifier stays addressable" */
  it("leaves a record identifier addressable rather than writing a marker over it", async () => {
    const privacy = createWorkerTracePrivacy({
      config: config(),
      dataPrivacy: dataPrivacyFor(policy()),
      featureFlags: flags,
    });
    const subject = span([
      { key: "scenario.run_id", value: { stringValue: "acme_aB3dEf7gHi2jKlMnOpQrStUv" } },
    ]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "scenario.run_id")).toBe("acme_aB3dEf7gHi2jKlMnOpQrStUv");
    await privacy.close();
  });
});

describe("given a deployment that named no analysis service", () => {
  const unconfigured = config({ presidio: { endpoint: undefined, timeoutMs: 60_000 } });

  /** @scenario "The privacy graph builds end to end from what the process already holds" */
  it("still scrubs the native floor at the essential level, and calls nothing", async () => {
    const privacy = createWorkerTracePrivacy({
      config: unconfigured,
      dataPrivacy: dataPrivacyFor(policy()),
      featureFlags: flags,
    });
    const subject = span([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "langwatch.input")).toBe("[EMAIL_ADDRESS]");
    expect(valueOf(subject, PRIVACY_PII_INCOMPLETE_MARKER_ATTR)).toBeUndefined();
    await privacy.close();
  });

  /** @scenario "An unavailable analysis service marks the span rather than hiding the gap" */
  it("keeps the floor and marks the span incomplete when strict was asked for", async () => {
    const privacy = createWorkerTracePrivacy({
      config: unconfigured,
      dataPrivacy: dataPrivacyFor(
        policy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
      ),
      featureFlags: flags,
    });
    const subject = span([
      { key: "langwatch.input", value: { stringValue: "Ana Silva at ana@example.com" } },
    ]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "langwatch.input")).toBe("Ana Silva at [EMAIL_ADDRESS]");
    expect(valueOf(subject, PRIVACY_PII_INCOMPLETE_MARKER_ATTR)).toBe("strict");
    await privacy.close();
  });

  /** @scenario "Production refuses a span it could not fully scrub" */
  it("refuses the span in production rather than storing it unscrubbed", async () => {
    const privacy = createWorkerTracePrivacy({
      config: { ...unconfigured, isProduction: true },
      dataPrivacy: dataPrivacyFor(null),
      featureFlags: flags,
    });
    const subject = span([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await expect(
      privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT),
    ).rejects.toThrow("LANGEVALS_ENDPOINT is not set");
    await privacy.close();
  });

  /** @scenario "Nothing resolvable falls back to the analysis-service path unchanged" */
  it("passes the span through untouched outside production when no policy resolves", async () => {
    const privacy = createWorkerTracePrivacy({
      config: unconfigured,
      dataPrivacy: dataPrivacyFor(null),
      featureFlags: flags,
    });
    const subject = span([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await privacy.spanRedactionPort().redact(subject, null, "ESSENTIAL", TENANT);

    expect(valueOf(subject, "langwatch.input")).toBe("ana@example.com");
    await privacy.close();
  });
});

describe("given the batch ceiling one span may spend", () => {
  /** @scenario "The privacy graph builds end to end from what the process already holds" */
  it("is the application's own literal, not a knob either process reads", () => {
    expect(WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH).toBe(250_000);
  });
});
