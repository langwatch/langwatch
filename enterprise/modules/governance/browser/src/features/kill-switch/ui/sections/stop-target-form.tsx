// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import {
  AGENT_STOP_TARGET_KINDS,
  type AgentStopTarget,
  type AgentStopTargetKind,
  agentStopTargetSchema,
} from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";

type Option = { value: string; label: string };

const EMPTY_FIELDS = {
  ingestionSourceId: "",
  endpointName: "",
  awsConnectionId: "",
  region: "",
  agentId: "",
  agentAliasId: "",
  virtualKeyId: "",
};
type TargetFields = typeof EMPTY_FIELDS;

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

function OptionSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const collection = createListCollection({ items: [...options] });
  return (
    <Field.Root required>
      <Field.Label>{label}</Field.Label>
      <Select.Root
        collection={collection}
        value={value ? [value] : []}
        onValueChange={(event) => onChange(event.value[0] ?? "")}
        size="sm"
      >
        <Select.Trigger aria-label={label}>
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field.Root required>
      <Field.Label>{label}</Field.Label>
      <Input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field.Root>
  );
}

const KIND_OPTIONS: Option[] = AGENT_STOP_TARGET_KINDS.map((kind) => ({
  value: kind,
  label: STOP_TARGET_KIND_LABELS[kind],
}));

const isTargetKind = (value: string): value is AgentStopTargetKind =>
  AGENT_STOP_TARGET_KINDS.some((kind) => kind === value);

/** One new plan target of any kind, checked against the contract before it joins the plan. */
export function StopTargetForm({
  databricksSources,
  awsConnections,
  onAdd,
}: {
  databricksSources: readonly Option[];
  awsConnections: readonly Option[];
  onAdd: (target: AgentStopTarget) => void;
}) {
  const [kind, setKind] = useState<AgentStopTargetKind>("databricks_serving_endpoint");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);

  const field = (name: keyof TargetFields) => ({
    value: fields[name],
    onChange: (value: string) => {
      setFields((previous) => ({ ...previous, [name]: value }));
      setError(null);
    },
  });

  const add = () => {
    const draft = draftTarget({ kind, fields });
    if (Object.values(draft).some((value) => value === "")) {
      setError("Fill in every field of the target.");
      return;
    }
    const parsed = agentStopTargetSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Fill in every field of the target.");
      return;
    }
    onAdd(parsed.data);
    setFields(EMPTY_FIELDS);
  };

  return (
    <VStack align="stretch" gap={3} data-testid="stop-target-form">
      <OptionSelect
        label="Target kind"
        options={KIND_OPTIONS}
        value={kind}
        placeholder="Pick a kind"
        onChange={(value) => {
          if (isTargetKind(value)) setKind(value);
          setError(null);
        }}
      />
      {kind === "databricks_serving_endpoint" && (
        <>
          <OptionSelect
            label="Databricks source"
            options={databricksSources}
            placeholder={
              databricksSources.length === 0 ? "No Databricks source connected" : "Pick a source"
            }
            {...field("ingestionSourceId")}
          />
          <TextField
            label="Serving endpoint name"
            placeholder="support-bot-prod"
            {...field("endpointName")}
          />
        </>
      )}
      {kind === "bedrock_agent_alias" && (
        <>
          <OptionSelect
            label="AWS connection"
            options={awsConnections}
            placeholder={
              awsConnections.length === 0 ? "Add an AWS connection below" : "Pick a connection"
            }
            {...field("awsConnectionId")}
          />
          <TextField label="Region" placeholder="eu-west-1" {...field("region")} />
          <HStack gap={3} align="start">
            <TextField label="Agent id" placeholder="AGENT12345" {...field("agentId")} />
            <TextField label="Alias id" placeholder="ALIAS12345" {...field("agentAliasId")} />
          </HStack>
        </>
      )}
      {kind === "gateway_virtual_key" && (
        <TextField label="Virtual key id" {...field("virtualKeyId")} />
      )}
      {error ? (
        <Text textStyle="sm" color="fg.error" role="alert">
          {error}
        </Text>
      ) : null}
      <HStack justify="end">
        <Button size="sm" variant="outline" onClick={add}>
          Add target
        </Button>
      </HStack>
    </VStack>
  );
}
