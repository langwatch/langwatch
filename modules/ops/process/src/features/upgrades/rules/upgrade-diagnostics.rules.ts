import {
  UPGRADE_DIAGNOSTICS_MAX_BYTES,
  type UpgradeDiagnosticsBundle,
} from "@langwatch/ops-contract";
import type { UpgradeStepDetail } from "@langwatch/upgrade/reader";
import { redactSecrets } from "@langwatch/upgrade/runner";
import { ledgerText } from "@langwatch/upgrade/step";

/** Keys a validation issue uses to quote the value it refused; that value may be customer data. */
const QUOTED_VALUE_KEYS = new Set(["received", "input"]);

export type DiagnosticsDeployment = UpgradeDiagnosticsBundle["deployment"];

/** Room left under the licence host's body cap for the submission around the bundle. */
const BUNDLE_MAX_BYTES = UPGRADE_DIAGNOSTICS_MAX_BYTES - 1024;

const scrubText = (text: string) => ledgerText({ text, redact: redactSecrets });

/** Every string redacted and cut, every quoted value dropped, each drop named in `omitted`. */
function scrub({
  value,
  path,
  omitted,
}: {
  value: unknown;
  path: string;
  omitted: string[];
}): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) {
    return value.map((each, index) => scrub({ value: each, path: `${path}[${index}]`, omitted }));
  }
  if (value === null || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [key, each] of Object.entries(value)) {
    const at = path === "" ? key : `${path}.${key}`;
    if (QUOTED_VALUE_KEYS.has(key)) {
      omitted.push(at);
      continue;
    }
    kept[key] = scrub({ value: each, path: at, omitted });
  }
  return kept;
}

const byteLengthOf = (bundle: UpgradeDiagnosticsBundle) =>
  Buffer.byteLength(JSON.stringify(bundle), "utf8");

/** Drops the oldest log lines, then the report, then the last targets, until the bundle fits. */
function fitted(bundle: UpgradeDiagnosticsBundle): UpgradeDiagnosticsBundle {
  let fitting = bundle;
  let dropped = 0;
  while (byteLengthOf(fitting) > BUNDLE_MAX_BYTES && fitting.step.logTail.length > 0) {
    dropped += 1;
    fitting = { ...fitting, step: { ...fitting.step, logTail: fitting.step.logTail.slice(1) } };
  }
  if (dropped > 0) {
    fitting = {
      ...fitting,
      omitted: [...fitting.omitted, `step.logTail: ${dropped} oldest lines`],
    };
  }
  if (byteLengthOf(fitting) > BUNDLE_MAX_BYTES && fitting.step.report !== null) {
    fitting = {
      ...fitting,
      step: { ...fitting.step, report: null },
      omitted: [...fitting.omitted, "step.report"],
    };
  }
  let shed = 0;
  while (byteLengthOf(fitting) > BUNDLE_MAX_BYTES && fitting.targets.length > 0) {
    shed += 1;
    fitting = { ...fitting, targets: fitting.targets.slice(0, -1) };
  }
  if (shed > 0) {
    fitting = { ...fitting, omitted: [...fitting.omitted, `targets: ${shed} of them`] };
  }
  return fitting;
}

/**
 * One failed step's diagnostics: the ledger row, its targets and log, and the deployment facts,
 * redacted and under the licence host's body cap. Spec: upgrade-diagnostics.feature
 */
export function upgradeDiagnosticsOf({
  step,
  deployment,
  generatedAt,
}: {
  step: UpgradeStepDetail;
  deployment: DiagnosticsDeployment;
  generatedAt: string;
}): UpgradeDiagnosticsBundle {
  const omitted: string[] = [];
  const report =
    step.report === null
      ? null
      : (scrub({ value: step.report, path: "step.report", omitted }) as Record<string, unknown>);
  return fitted({
    format: 1,
    generatedAt,
    step: {
      id: step.id,
      kind: step.kind,
      mode: step.mode,
      description: step.description,
      release: step.release,
      status: step.status,
      attempt: step.attempt,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      updatedAt: step.updatedAt,
      lastError: step.lastError === null ? null : scrubText(step.lastError),
      report,
      logTail: step.logTail.map(scrubText),
    },
    targets: step.targets.map((target) => ({
      target: target.target,
      status: target.status,
      version: target.version,
      lastError: target.lastError === null ? null : scrubText(target.lastError),
    })),
    deployment,
    omitted,
  });
}

/**
 * A bundle an operator reviewed, put through the same redaction and size cap again before it
 * leaves the install. A bundle this module built comes back unchanged.
 */
export function resealedDiagnosticsOf(bundle: UpgradeDiagnosticsBundle): UpgradeDiagnosticsBundle {
  const omitted: string[] = [];
  const scrubbed = scrub({ value: bundle, path: "", omitted }) as UpgradeDiagnosticsBundle;
  return fitted({ ...scrubbed, omitted: [...scrubbed.omitted, ...omitted] });
}
