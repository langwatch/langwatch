import { z } from "zod";

/** Structured LangWatchQL refusal detail lifted from an untrusted transport. */
export const LWQL_UNPARSEABLE_CODE = "lwql_unparseable";
export const LWQL_NOT_PERMITTED_CODE = "lwql_not_permitted";
export const LWQL_PARAMETER_MISSING_CODE = "lwql_parameter_missing";
export const LWQL_RESERVED_PARAMETER_SUPPLIED_CODE = "lwql_reserved_parameter_supplied";
export const LWQL_UNAVAILABLE_CODE = "lwql_unavailable";
export const LWQL_NOT_ENABLED_CODE = "lwql_not_enabled";
export const LWQL_TIMEOUT_CODE = "query_timeout";

export interface LangWatchQLSourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface LangWatchQLViolationView {
  readonly code: string;
  readonly clause: string;
  readonly message: string;
  readonly at?: LangWatchQLSourcePosition;
}

export interface LangWatchQLFailure {
  readonly code: string | undefined;
  readonly violations: readonly LangWatchQLViolationView[];
  readonly parameters: readonly string[];
}

const NO_FAILURE: LangWatchQLFailure = {
  code: void 0,
  violations: [],
  parameters: [],
};

const recordSchema = z.record(z.string(), z.unknown());
const sourcePositionSchema = z.object({
  line: z.number().finite(),
  column: z.number().finite(),
});
const violationSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    clause: z.string().optional(),
    at: z.unknown().optional(),
  })
  .passthrough();
const failurePayloadSchema = z
  .object({ code: z.string(), meta: z.unknown().optional() })
  .passthrough();

function positionOf(value: unknown): LangWatchQLSourcePosition | undefined {
  const parsed = sourcePositionSchema.safeParse(value);
  return parsed.success ? parsed.data : void 0;
}

function violationOf(value: unknown): LangWatchQLViolationView | undefined {
  const parsed = violationSchema.safeParse(value);
  if (!parsed.success) return void 0;

  const at = positionOf(parsed.data.at);
  return {
    code: parsed.data.code,
    clause: parsed.data.clause ?? "statement",
    message: parsed.data.message,
    ...(at ? { at } : {}),
  };
}

function stringsOf(value: unknown): readonly string[] {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function recordAt(error: unknown): Record<string, unknown> | undefined {
  const outer = recordSchema.safeParse(error);
  if (!outer.success) return void 0;

  const data = recordSchema.safeParse(outer.data.data);
  const nested = data.success ? recordSchema.safeParse(data.data.error) : data;
  if (nested.success) return nested.data;

  const direct = recordSchema.safeParse(outer.data.error);
  return direct.success ? direct.data : outer.data;
}

export function readLangWatchQLFailure(error: unknown): LangWatchQLFailure {
  const payload = recordAt(error);
  const parsedPayload = failurePayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return NO_FAILURE;

  const parsedMeta = recordSchema.safeParse(parsedPayload.data.meta);
  const meta = parsedMeta.success ? parsedMeta.data : parsedPayload.data;
  const parsedViolations = z.array(z.unknown()).safeParse(meta.violations);
  const violations = parsedViolations.success
    ? parsedViolations.data
        .map(violationOf)
        .filter((entry): entry is LangWatchQLViolationView => entry !== void 0)
    : [];
  return {
    code: parsedPayload.data.code,
    violations,
    parameters: stringsOf(meta.parameters),
  };
}

export interface LangWatchQLEditorMarker {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export function lwqlEditorMarkers(
  failure: LangWatchQLFailure,
): readonly LangWatchQLEditorMarker[] {
  return failure.violations
    .filter(
      (
        violation,
      ): violation is LangWatchQLViolationView & { at: LangWatchQLSourcePosition } =>
        violation.at !== void 0,
    )
    .map((violation) => ({
      line: violation.at.line,
      column: violation.at.column,
      message: violation.message,
    }));
}

/** The availability response shape used by the app's error presentation registry. */
export function lwqlUnavailablePayload(): unknown {
  return {
    data: {
      error: {
        code: LWQL_UNAVAILABLE_CODE,
        httpStatus: 503,
        fault: "platform",
        meta: {},
      },
    },
  };
}

/** The feature-switch-off response shape used by the app's error registry. */
export function lwqlNotEnabledPayload(): unknown {
  return {
    data: {
      error: {
        code: LWQL_NOT_ENABLED_CODE,
        httpStatus: 403,
        fault: "customer",
        meta: {},
      },
    },
  };
}
