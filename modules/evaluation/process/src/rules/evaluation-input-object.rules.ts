/** Where an oversized evaluation input lives (ADR-172): kind, class, tenant, content hash. */
export const EVALUATION_INPUTS_PREFIX = "evaluation-inputs";

/** The published retention classes in days; a project's retention rounds up to the next one. */
export const EVALUATION_INPUT_RETENTION_CLASS_DAYS = [90, 180, 365, 730] as const;

export const INDEFINITE_RETENTION_CLASS = "r-indefinite" as const;

export type EvaluationInputRetentionClass =
  | `r${(typeof EVALUATION_INPUT_RETENTION_CLASS_DAYS)[number]}`
  | typeof INDEFINITE_RETENTION_CLASS;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const CLASS_SEGMENT = "r(?:90|180|365|730|-indefinite)";

/** Zero days keeps data for ever, and so does a period beyond the longest class. */
export function retentionClassOf({
  retentionDays,
}: {
  retentionDays: number;
}): EvaluationInputRetentionClass {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return INDEFINITE_RETENTION_CLASS;
  const days = EVALUATION_INPUT_RETENTION_CLASS_DAYS.find((limit) => retentionDays <= limit);
  return days === undefined ? INDEFINITE_RETENTION_CLASS : `r${days}`;
}

export function evaluationInputKey({
  retentionClass,
  tenantId,
  sha256,
}: {
  retentionClass: EvaluationInputRetentionClass;
  tenantId: string;
  sha256: string;
}): string {
  return `${EVALUATION_INPUTS_PREFIX}/${retentionClass}/${tenantId}/${sha256}.json`;
}

/** Main-era objects sit at `<projectId>/<sha256>`, the address a stored object's bytes had. */
export function legacyEvaluationInputKey({
  tenantId,
  sha256,
}: {
  tenantId: string;
  sha256: string;
}): string {
  return `${tenantId}/${sha256}`;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** Whether a key is one this tenant's inputs can have; a marker never names another project's. */
export function isEvaluationInputKeyOf({
  tenantId,
  key,
}: {
  tenantId: string;
  key: string;
}): boolean {
  const current = new RegExp(
    `^${EVALUATION_INPUTS_PREFIX}/${CLASS_SEGMENT}/${escapeRegExp(tenantId)}/[a-f0-9]{64}\\.json$`,
    "u",
  );
  const legacy = new RegExp(`^${escapeRegExp(tenantId)}/[a-f0-9]{64}$`, "u");
  return current.test(key) || legacy.test(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
