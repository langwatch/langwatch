import {
  connectorAgentConfigSchema,
  MAX_CALL_TIMEOUT_MS,
  type ConnectorAgentConfig,
} from "@langwatch/agent-contract";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { CALL_STARTER } from "./connector-starters.ts";

/** The release flag the connector card and editor read; runs check the same flag (ADR-194). */
export const SCENARIO_CONNECTOR_FLAG_KEY = FrontendFlags.release_scenario_connector_steps;

export type ConnectorForm = {
  name: string;
  callCode: string;
  /** Null while the agent has no setup block. */
  setupCode: string | null;
  /** Null while the agent has no teardown block. */
  teardownCode: string | null;
  secretNames: readonly string[];
  /** Empty for no fixtures dataset. */
  fixturesDatasetId: string;
  /** Seconds as typed; empty keeps the default budget. */
  timeoutSeconds: string;
  /** Stored config fields this editor does not show, written back unchanged. */
  kept: Readonly<Record<string, unknown>>;
};

export const EMPTY_CONNECTOR_FORM: ConnectorForm = {
  name: "",
  callCode: CALL_STARTER,
  setupCode: null,
  teardownCode: null,
  secretNames: [],
  fixturesDatasetId: "",
  timeoutSeconds: "",
  kept: {},
};

/** The form a saved agent seeds; a config that no longer parses seeds what it still holds. */
export function formFromAgent(agent: { name?: string | null; config?: unknown }): ConnectorForm {
  const name = agent.name ?? "";
  const parsed = connectorAgentConfigSchema.safeParse(agent.config ?? {});
  if (!parsed.success) return { ...formFromRawConfig({ config: agent.config }), name };
  const { call, setup, teardown, secretNames, fixturesDatasetId, timeoutMs, ...kept } = parsed.data;
  return {
    name,
    callCode: call.code,
    setupCode: setup?.code ?? null,
    teardownCode: teardown?.code ?? null,
    secretNames,
    fixturesDatasetId: fixturesDatasetId ?? "",
    timeoutSeconds: timeoutMs === undefined ? "" : String(timeoutMs / 1000),
    kept,
  };
}

/** A project dataset the fixtures picker offers. */
export type ConnectorDatasetOption = { id: string; name: string };

export type ConnectorFormField =
  | "name"
  | "call"
  | "setup"
  | "teardown"
  | "secretNames"
  | "timeoutMs"
  | "config";

export type ConnectorFormErrors = Partial<Record<ConnectorFormField, string>>;

export type ConnectorFormCheck =
  | { ok: true; config: ConnectorAgentConfig }
  | { ok: false; errors: ConnectorFormErrors };

const TIMEOUT_MESSAGE = `The timeout is a number of seconds above zero and at most ${MAX_CALL_TIMEOUT_MS / 1000}.`;

/** Whitespace alone is no code, so it meets the schema's "needs code" refusal. */
function blockOf(code: string) {
  return { language: "python" as const, code: code.trim() === "" ? "" : code };
}

function timeoutMsOf(seconds: string): number | undefined {
  if (seconds.trim() === "") return void 0;
  return Math.round(Number(seconds) * 1000);
}

function candidateConfigOf(form: ConnectorForm): Record<string, unknown> {
  const timeoutMs = timeoutMsOf(form.timeoutSeconds);
  return {
    ...form.kept,
    call: blockOf(form.callCode),
    ...(form.setupCode === null ? {} : { setup: blockOf(form.setupCode) }),
    ...(form.teardownCode === null ? {} : { teardown: blockOf(form.teardownCode) }),
    secretNames: [...form.secretNames],
    ...(form.fixturesDatasetId ? { fixturesDatasetId: form.fixturesDatasetId } : {}),
    ...(timeoutMs === void 0 ? {} : { timeoutMs }),
  };
}

const FIELD_BY_KEY: Readonly<Record<string, ConnectorFormField>> = {
  call: "call",
  setup: "setup",
  teardown: "teardown",
  secretNames: "secretNames",
  timeoutMs: "timeoutMs",
};

/** The stored config the form makes, checked by the connector schema the server checks with. */
export function checkConnectorForm(form: ConnectorForm): ConnectorFormCheck {
  const errors: ConnectorFormErrors = {};
  if (form.name.trim().length === 0) errors.name = "Name is required";
  const parsed = connectorAgentConfigSchema.safeParse(candidateConfigOf(form));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_BY_KEY[String(issue.path[0])] ?? "config";
      errors[field] ??= field === "timeoutMs" ? TIMEOUT_MESSAGE : issue.message;
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, config: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blockCode({ block }: { block: unknown }): string | null {
  return isRecord(block) && typeof block.code === "string" ? block.code : null;
}

/**
 * A stored config the schema now refuses (for example one saved before a cap) keeps its blocks and
 * picks in the form, so a save shows what to fix instead of replacing them with the starter code.
 */
function formFromRawConfig({ config }: { config: unknown }): Omit<ConnectorForm, "name"> {
  if (!isRecord(config)) return EMPTY_CONNECTOR_FORM;
  const { call, setup, teardown, secretNames, fixturesDatasetId, timeoutMs, ...kept } = config;
  return {
    callCode: blockCode({ block: call }) ?? "",
    setupCode: blockCode({ block: setup }),
    teardownCode: blockCode({ block: teardown }),
    secretNames: Array.isArray(secretNames)
      ? secretNames.filter((secret): secret is string => typeof secret === "string")
      : [],
    fixturesDatasetId: typeof fixturesDatasetId === "string" ? fixturesDatasetId : "",
    timeoutSeconds: typeof timeoutMs === "number" ? String(timeoutMs / 1000) : "",
    kept,
  };
}
