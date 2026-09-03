import { PiiAnalysisMetricsPort, type PiiAnalysisOutcome } from "@langwatch/data-privacy-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerTracePrivacyConfig } from "../../config/worker.config";
import { WorkerPiiAnalysisAdapter } from "../worker-pii-analysis.adapter";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * The wire format between this process and the analysis service, pinned by
 * literal. The service answers with anonymized text and no positions, so a
 * request this process shapes differently is redacted differently and the
 * response carries nothing that would show it.
 */

const inspectContent = vi.fn();
vi.mock("@google-cloud/dlp", () => ({
  DlpServiceClient: class {
    inspectContent = inspectContent;
    close = async () => undefined;
  },
}));

class RecordingMetrics extends PiiAnalysisMetricsPort {
  readonly calls: string[] = [];
  readonly durations: number[] = [];
  readonly outcomes: PiiAnalysisOutcome[] = [];

  analysisCalled(method: string): void {
    this.calls.push(method);
  }

  analysisObserved(durationMs: number): void {
    this.durations.push(durationMs);
  }

  analysisFinished(outcome: PiiAnalysisOutcome): void {
    this.outcomes.push(outcome);
  }
}

const config = (over: Partial<WorkerTracePrivacyConfig> = {}): WorkerTracePrivacyConfig => ({
  googleDlp: { disabled: false, credentials: { project_id: "privacy-project" } },
  presidio: { endpoint: "http://langevals", timeoutMs: 60_000 },
  isProduction: false,
  nativePolicyEnforced: true,
  ...over,
});

function adapterFor(over: Partial<WorkerTracePrivacyConfig> = {}) {
  const metrics = new RecordingMetrics();
  return {
    metrics,
    adapter: WorkerPiiAnalysisAdapter.create({ config: config(over), metrics }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  inspectContent.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const presidioAnswering = (results: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => results } as unknown as Response);

describe("given a Presidio batch call", () => {
  /** @scenario "The analysis request is the one the service expects" */
  it("posts to the evaluate path with the level's entity list and the threshold", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "hello <PERSON>" } }]);
    const { adapter } = adapterFor();

    await adapter.clearPresidio(["hello Ana"], "ESSENTIAL");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://langevals/presidio/pii_detection/evaluate");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.data).toEqual([{ input: "hello Ana" }]);
    expect(body.settings.min_threshold).toBe(0.5);
    expect(body.env).toEqual({});
    expect(Object.keys(body.settings.entities)).toEqual([
      "credit_card",
      "crypto",
      "email_address",
      "iban_code",
      "ip_address",
      "phone_number",
      "medical_license",
      "us_bank_number",
      "us_driver_license",
      "us_itin",
      "us_passport",
      "us_ssn",
      "uk_nhs",
      "sg_nric_fin",
      "au_abn",
      "au_acn",
      "au_tfn",
      "au_medicare",
      "in_pan",
      "in_aadhaar",
      "in_vehicle_registration",
      "in_voter",
      "in_passport",
    ]);
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("asks for the analyzer's full list at the strict level, names and locations included", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "x" } }]);
    const { adapter } = adapterFor();

    await adapter.clearPresidio(["hello Ana"], "STRICT");

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(Object.keys(body.settings.entities)).toContain("person");
    expect(Object.keys(body.settings.entities)).toContain("location");
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("asks for exactly the entities it was given when the custom level names them", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "x" } }]);
    const { adapter } = adapterFor();

    await adapter.clearPresidio(["hello Ana"], "STRICT", ["PERSON", "LOCATION"]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.settings.entities).toEqual({ person: true, location: true });
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("normalizes the analyzer's angle-bracket markers to the platform's brackets", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "hello <PERSON>" } }]);
    const { adapter } = adapterFor();

    expect(await adapter.clearPresidio(["hello Ana"], "STRICT")).toEqual(["hello [PERSON]"]);
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("scans the first 250,000 characters and puts the rest back unscanned", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "scanned" } }]);
    const { adapter } = adapterFor();
    const long = `${"a".repeat(250_000)}TAIL`;

    const [result] = await adapter.clearPresidio([long], "ESSENTIAL");

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data[0].input.length).toBe(250_000);
    expect(result).toBe("scannedTAIL");
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("returns null for a text the analyzer left alone", async () => {
    presidioAnswering([{ status: "skipped" }]);
    const { adapter } = adapterFor();

    expect(await adapter.clearPresidio(["nothing"], "ESSENTIAL")).toEqual([null]);
  });

  /** @scenario "The analysis request is the one the service expects" */
  it("makes no call at all for an empty batch", async () => {
    const { adapter, metrics } = adapterFor();

    expect(await adapter.clearPresidio([], "ESSENTIAL")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(metrics.calls).toEqual([]);
  });

  /** @scenario "A batch answered with the wrong number of results is refused" */
  it("refuses a response that does not answer every input", async () => {
    presidioAnswering([]);
    const { adapter, metrics } = adapterFor();

    await expect(adapter.clearPresidio(["a", "b"], "ESSENTIAL")).rejects.toThrow(
      "Unexpected batch response: expected 2 results, got 0",
    );
    expect(metrics.outcomes).toEqual(["error"]);
  });

  /** @scenario "A batch answered with the wrong number of results is refused" */
  it("raises the analyzer's own error for a result it reports as failed", async () => {
    presidioAnswering([{ status: "error", details: "analyzer exploded" }]);
    const { adapter } = adapterFor();

    await expect(adapter.clearPresidio(["a"], "ESSENTIAL")).rejects.toThrow("analyzer exploded");
  });

  /** @scenario "A batch answered with the wrong number of results is refused" */
  it("raises the body of a non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => "502 bad gateway",
    } as unknown as Response);
    const { adapter, metrics } = adapterFor();

    await expect(adapter.clearPresidio(["a"], "ESSENTIAL")).rejects.toThrow("502 bad gateway");
    expect(metrics.outcomes).toEqual(["error"]);
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("records one call, one duration and one outcome per batch", async () => {
    presidioAnswering([{ status: "processed", raw_response: { anonymized: "x" } }]);
    const { adapter, metrics } = adapterFor();

    await adapter.clearPresidio(["a"], "ESSENTIAL");

    expect(metrics.calls).toEqual(["presidio"]);
    expect(metrics.durations).toHaveLength(1);
    expect(metrics.outcomes).toEqual(["processed"]);
  });
});

describe("given a Google DLP call", () => {
  /** @scenario "The DLP fallback refuses by name when it is unavailable" */
  it("refuses by name when DLP is turned off for the deployment", async () => {
    const { adapter } = adapterFor({ googleDlp: { disabled: true, credentials: undefined } });

    await expect(
      adapter.tryClearGoogleDlp({ text: "a", piiRedactionLevel: "ESSENTIAL" }),
    ).rejects.toThrow("LANGWATCH_DISABLE_GOOGLE_DLP");
  });

  /** @scenario "The DLP fallback refuses by name when it is unavailable" */
  it("refuses by name when no credentials were configured", async () => {
    const { adapter } = adapterFor({ googleDlp: { disabled: false, credentials: undefined } });

    await expect(
      adapter.tryClearGoogleDlp({ text: "a", piiRedactionLevel: "ESSENTIAL" }),
    ).rejects.toThrow("GOOGLE_APPLICATION_CREDENTIALS");
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("inspects under the credentials' own project and asks for the matched text", async () => {
    inspectContent.mockResolvedValue([{ result: { findings: [] } }]);
    const { adapter } = adapterFor();

    await adapter.tryClearGoogleDlp({ text: "hello", piiRedactionLevel: "ESSENTIAL" });

    const request = inspectContent.mock.calls[0]![0];
    expect(request.parent).toBe("projects/privacy-project/locations/global");
    expect(request.inspectConfig.includeQuote).toBe(true);
    expect(request.inspectConfig.minLikelihood).toBe("POSSIBLE");
    expect(request.inspectConfig.limits).toEqual({ maxFindingsPerRequest: 0 });
    expect(request.inspectConfig.infoTypes).toEqual([
      { name: "PHONE_NUMBER" },
      { name: "EMAIL_ADDRESS" },
      { name: "CREDIT_CARD_NUMBER" },
      { name: "IBAN_CODE" },
      { name: "IP_ADDRESS" },
      { name: "PASSPORT" },
      { name: "VAT_NUMBER" },
      { name: "MEDICAL_RECORD_NUMBER" },
    ]);
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("adds the name, birth-date and address types at the strict level", async () => {
    inspectContent.mockResolvedValue([{ result: { findings: [] } }]);
    const { adapter } = adapterFor();

    await adapter.tryClearGoogleDlp({ text: "hello", piiRedactionLevel: "STRICT" });

    const names = inspectContent.mock.calls[0]![0].inspectConfig.infoTypes.map(
      (t: { name: string }) => t.name,
    );
    expect(names).toEqual([
      "FIRST_NAME",
      "LAST_NAME",
      "PERSON_NAME",
      "DATE_OF_BIRTH",
      "LOCATION",
      "STREET_ADDRESS",
      "PHONE_NUMBER",
      "EMAIL_ADDRESS",
      "CREDIT_CARD_NUMBER",
      "IBAN_CODE",
      "IP_ADDRESS",
      "PASSPORT",
      "VAT_NUMBER",
      "MEDICAL_RECORD_NUMBER",
    ]);
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("replaces a finding's range and returns the redacted text", async () => {
    inspectContent.mockResolvedValue([
      {
        result: {
          findings: [{ quote: "Ana", location: { codepointRange: { start: 6, end: 9 } } }],
        },
      },
    ]);
    const { adapter, metrics } = adapterFor();

    const redacted = await adapter.tryClearGoogleDlp({
      text: "hello Ana bye",
      piiRedactionLevel: "ESSENTIAL",
    });

    expect(redacted).toBe("hello [REDACTED] bye");
    expect(metrics.calls).toEqual(["google_dlp"]);
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("returns null when nothing was masked, so the caller keeps the original", async () => {
    inspectContent.mockResolvedValue([{ result: { findings: [] } }]);
    const { adapter } = adapterFor();

    expect(
      await adapter.tryClearGoogleDlp({ text: "hello", piiRedactionLevel: "ESSENTIAL" }),
    ).toBeNull();
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("leaves a finding whose whole matched text a policy exception covers", async () => {
    inspectContent.mockResolvedValue([
      {
        result: {
          findings: [{ quote: "Ana", location: { codepointRange: { start: 6, end: 9 } } }],
        },
      },
    ]);
    const { adapter } = adapterFor();

    expect(
      await adapter.tryClearGoogleDlp({
        text: "hello Ana bye",
        piiRedactionLevel: "ESSENTIAL",
        exceptPatterns: ["Ana"],
      }),
    ).toBeNull();
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("keeps one gRPC channel across concurrent checks and closes it once", async () => {
    inspectContent.mockResolvedValue([{ result: { findings: [] } }]);
    const { adapter } = adapterFor();

    const [first, second] = await Promise.all([adapter.getDlpClient(), adapter.getDlpClient()]);

    expect(first).toBe(second);
    await adapter.close();
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("closes cleanly when no DLP check ever ran", async () => {
    const { adapter } = adapterFor();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
