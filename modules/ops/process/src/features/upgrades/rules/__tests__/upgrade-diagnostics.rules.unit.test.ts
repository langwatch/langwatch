import {
  UPGRADE_DIAGNOSTICS_MAX_BYTES,
  upgradeDiagnosticsBundleSchema,
} from "@langwatch/ops-contract";
import type { UpgradeStepDetail } from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { resealedDiagnosticsOf, upgradeDiagnosticsOf } from "../upgrade-diagnostics.rules.ts";

const DEPLOYMENT = {
  imageRelease: "3.23.0",
  chartVersion: "1.4.2",
  installMethod: "helm",
  instanceId: "inst-1",
};
const GENERATED_AT = "2026-10-20T10:00:00.000Z";

function stepDetail(overrides: Partial<UpgradeStepDetail> = {}): UpgradeStepDetail {
  return {
    id: "ops:backfill",
    kind: "ops-backfill",
    release: "3.23.0",
    mode: "background",
    status: "failed",
    statusLabel: "Failed",
    owner: null,
    description: "Backfill the thing",
    finishBy: null,
    recorded: true,
    inferred: false,
    attempt: 3,
    lastError: "boom",
    report: { checkpoint: 12 },
    logTail: ["starting", "failed at row 12"],
    progress: null,
    waitingOn: [],
    runId: null,
    startedAt: "2026-10-20T09:00:00.000Z",
    finishedAt: "2026-10-20T09:05:00.000Z",
    updatedAt: "2026-10-20T09:05:00.000Z",
    targets: [
      {
        target: "org-1",
        status: "failed",
        version: "3.22.0",
        lastError: "target boom",
      } as UpgradeStepDetail["targets"][number],
    ],
    ...overrides,
  };
}

const bundleOf = (step: UpgradeStepDetail) =>
  upgradeDiagnosticsOf({ step, deployment: DEPLOYMENT, generatedAt: GENERATED_AT });

describe("upgradeDiagnosticsOf", () => {
  describe("given a failed background step with a target error and a log tail", () => {
    /** @scenario "A step's diagnostics bundle names the step, its error, targets, log and deployment" */
    it("carries the step, its report, targets, log and deployment", () => {
      const bundle = bundleOf(stepDetail());

      expect(bundle.format).toBe(1);
      expect(bundle.generatedAt).toBe(GENERATED_AT);
      expect(bundle.step).toMatchObject({
        id: "ops:backfill",
        mode: "background",
        release: "3.23.0",
        status: "failed",
        attempt: 3,
        lastError: "boom",
        report: { checkpoint: 12 },
        logTail: ["starting", "failed at row 12"],
      });
      expect(bundle.targets).toEqual([
        { target: "org-1", status: "failed", version: "3.22.0", lastError: "target boom" },
      ]);
      expect(bundle.deployment).toEqual(DEPLOYMENT);
      expect(bundle.omitted).toEqual([]);
    });
  });

  describe("given a report holding a validation issue with its received input", () => {
    /** @scenario "A diagnostics bundle drops the values a validation error quotes" */
    it("keeps the issue's path and message but drops the received input, naming it", () => {
      const bundle = bundleOf(
        stepDetail({
          report: {
            issues: [{ path: ["owner", "email"], message: "Invalid email", received: "a@b.c" }],
            input: { email: "a@b.c" },
          },
        }),
      );

      expect(bundle.step.report).toEqual({
        issues: [{ path: ["owner", "email"], message: "Invalid email" }],
      });
      expect(bundle.omitted).toEqual(["step.report.issues[0].received", "step.report.input"]);
      expect(JSON.stringify(bundle)).not.toContain("a@b.c");
    });
  });

  describe("given a report holding a URL with a password and a 10 KB string", () => {
    /** @scenario "A diagnostics bundle redacts secrets and cuts long strings" */
    it("masks the password and cuts the string to 4 KB", () => {
      const bundle = bundleOf(
        stepDetail({
          report: {
            url: "postgres://admin:hunter2-secret@db.internal:5432/langwatch",
            blob: "x".repeat(10 * 1024),
          },
        }),
      );

      const report = bundle.step.report as { url: string; blob: string };
      expect(report.url).not.toContain("hunter2-secret");
      expect(report.url).toContain("db.internal");
      expect(report.blob.length).toBeLessThanOrEqual(4096);
      expect(report.blob.length).toBeLessThan(10 * 1024);
    });
  });

  describe("given a report, error and log carrying structured credentials", () => {
    /** @scenario "A diagnostics bundle drops secret-named fields and masks credentials in text" */
    it("drops the secret-named fields, masks the credentials in text and names each drop", () => {
      const bundle = bundleOf(
        stepDetail({
          report: {
            checkpoint: 12,
            password: "synthetic-secret",
            headers: { authorization: "Bearer synthetic-token" },
            provider: { apiKey: "synthetic-key", region: "eu-west-1" },
          },
          lastError: 'request failed: {"apiKey":"synthetic-key-2","model":"gpt"}',
          logTail: [
            "calling provider with Authorization: Bearer synthetic-token-2",
            'fields {"client_secret": "synthetic secret 3", "rows": 12}',
            "retrying with x-api-key: synthetic-key-4",
            `provider rejected sk-ant-api03-${"synthetic".repeat(5)}`,
          ],
        }),
      );

      expect(bundle.step.report).toEqual({
        checkpoint: 12,
        headers: {},
        provider: { region: "eu-west-1" },
      });
      expect(bundle.omitted).toEqual([
        "step.report.password",
        "step.report.headers.authorization",
        "step.report.provider.apiKey",
      ]);
      expect(bundle.step.lastError).toBe('request failed: {"apiKey":"***","model":"gpt"}');
      expect(bundle.step.logTail.slice(0, 3)).toEqual([
        "calling provider with Authorization: Bearer ***",
        'fields {"client_secret": "***", "rows": 12}',
        "retrying with x-api-key: ***",
      ]);
      expect(bundle.step.logTail.at(-1)).toMatch(/^provider rejected /);
      expect(JSON.stringify(bundle)).not.toMatch(/synthetic/);
    });
  });

  describe("given a report and log that would exceed 64 KB", () => {
    /** @scenario "A diagnostics bundle stays under its size cap" */
    it("ends at most 64 KB and names what it left out", () => {
      const lines = Array.from({ length: 40 }, (_, line) => `${line}:`.padEnd(2000, "l"));
      const report = Object.fromEntries(
        Array.from({ length: 40 }, (_, key) => [`k${key}`, `${key}`.padEnd(2000, "r")]),
      );
      const bundle = bundleOf(stepDetail({ logTail: lines, report }));

      expect(Buffer.byteLength(JSON.stringify(bundle), "utf8")).toBeLessThanOrEqual(
        UPGRADE_DIAGNOSTICS_MAX_BYTES - 1024,
      );
      expect(bundle.omitted.some((each) => each.startsWith("step.logTail"))).toBe(true);
    });

    it("drops the report too when the log alone cannot make it fit", () => {
      const report = Object.fromEntries(
        Array.from({ length: 40 }, (_, key) => [`k${key}`, `${key}`.padEnd(3000, "r")]),
      );
      const bundle = bundleOf(stepDetail({ logTail: ["short"], report }));

      expect(Buffer.byteLength(JSON.stringify(bundle), "utf8")).toBeLessThanOrEqual(
        UPGRADE_DIAGNOSTICS_MAX_BYTES - 1024,
      );
      expect(bundle.step.report).toBeNull();
      expect(bundle.omitted).toContain("step.report");
    });

    it("sheds targets too when the log and report gone still leave it too big", () => {
      const targets = Array.from({ length: 40 }, (_, index) => ({
        target: `org-${index}`,
        status: "failed",
        version: "3.22.0",
        lastError: `${index}`.padEnd(3000, "t"),
      })) as UpgradeStepDetail["targets"];
      const bundle = bundleOf(stepDetail({ logTail: ["short"], report: null, targets }));

      expect(Buffer.byteLength(JSON.stringify(bundle), "utf8")).toBeLessThanOrEqual(
        UPGRADE_DIAGNOSTICS_MAX_BYTES - 1024,
      );
      expect(bundle.targets.length).toBeLessThan(40);
      expect(bundle.omitted).toContain(`targets: ${40 - bundle.targets.length} of them`);
    });
  });

  describe("given a bundle it built at the size cap", () => {
    /** @scenario "A diagnostics bundle stays under its size cap" */
    it("passes the bundle schema and comes back unchanged when resealed", () => {
      const lines = Array.from({ length: 200 }, (_, line) => `${line}:`.padEnd(4000, "l"));
      const bundle = bundleOf(stepDetail({ logTail: lines }));

      expect(upgradeDiagnosticsBundleSchema.validate(bundle)).toBe(true);
      expect(resealedDiagnosticsOf(bundle)).toEqual(bundle);
    });
  });
});

describe("upgradeDiagnosticsBundleSchema", () => {
  describe("given a reviewed bundle past the size cap", () => {
    /** @scenario "A reviewed bundle past the size cap is refused before it is resealed" */
    it("refuses it, and refuses a log past 200 lines or a line past 4 KB", () => {
      const built = bundleOf(stepDetail());
      const withLog = (logTail: string[]) => ({ ...built, step: { ...built.step, logTail } });

      expect(upgradeDiagnosticsBundleSchema.validate(withLog(Array(201).fill("l")))).toBe(false);
      expect(upgradeDiagnosticsBundleSchema.validate(withLog(["l".repeat(4097)]))).toBe(false);
      const oversized = { ...built, step: { ...built.step, report: { blob: "r".repeat(70_000) } } };
      expect(upgradeDiagnosticsBundleSchema.validate(oversized)).toBe(false);
    });
  });
});
