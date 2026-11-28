// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One new stop plan target being typed: its kind, its fields, and the check against the
 * contract before it joins the plan.
 */
import {
  AGENT_STOP_TARGET_KINDS,
  type AgentStopTarget,
  type AgentStopTargetKind,
  agentStopTargetSchema,
} from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

const EMPTY_FIELDS = {
  ingestionSourceId: "",
  endpointName: "",
  awsConnectionId: "",
  region: "",
  agentId: "",
  agentAliasId: "",
  virtualKeyId: "",
};
export type TargetFields = typeof EMPTY_FIELDS;
export type TargetFieldBinding = { value: string; onChange: (value: string) => void };

const INCOMPLETE = "Fill in every field of the target.";

function draftTarget({ kind, fields }: { kind: AgentStopTargetKind; fields: TargetFields }) {
  const trim = (value: string) => value.trim();
  switch (kind) {
    case "databricks_serving_endpoint":
      return {
        kind,
        ingestionSourceId: fields.ingestionSourceId,
        endpointName: trim(fields.endpointName),
      };
    case "bedrock_agent_alias":
      return {
        kind,
        awsConnectionId: fields.awsConnectionId,
        region: trim(fields.region),
        agentId: trim(fields.agentId),
        agentAliasId: trim(fields.agentAliasId),
      };
    case "gateway_virtual_key":
      return { kind, virtualKeyId: trim(fields.virtualKeyId) };
  }
}

const isTargetKind = (value: string): value is AgentStopTargetKind =>
  AGENT_STOP_TARGET_KINDS.some((kind) => kind === value);

export function useStopTargetDraft({ onAdd }: { onAdd: (target: AgentStopTarget) => void }) {
  const [kind, setKind] = useState<AgentStopTargetKind>("databricks_serving_endpoint");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);

  const field = (name: keyof TargetFields): TargetFieldBinding => ({
    value: fields[name],
    onChange: (value: string) => {
      setFields((previous) => ({ ...previous, [name]: value }));
      setError(null);
    },
  });

  const add = () => {
    const draft = draftTarget({ kind, fields });
    if (Object.values(draft).some((value) => value === "")) {
      setError(INCOMPLETE);
      return;
    }
    const parsed = agentStopTargetSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? INCOMPLETE);
      return;
    }
    onAdd(parsed.data);
    setFields(EMPTY_FIELDS);
  };

  const pickKind = (value: string) => {
    if (isTargetKind(value)) setKind(value);
    setError(null);
  };

  return { kind, pickKind, field, error, add };
}
