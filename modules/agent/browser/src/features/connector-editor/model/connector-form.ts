import { connectorAgentConfigSchema, type ConnectorAgentConfig } from "@langwatch/agent-contract";
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

/** The form a saved agent seeds; a config that no longer parses seeds the defaults. */
export function formFromAgent(agent: { name?: string | null; config?: unknown }): ConnectorForm {
  const name = agent.name ?? "";
  const parsed = connectorAgentConfigSchema.safeParse(agent.config ?? {});
  if (!parsed.success) return { ...EMPTY_CONNECTOR_FORM, name };
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

const TIMEOUT_MESSAGE = "The timeout is a number of seconds above zero.";

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
