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
} from "@langwatch/enterprise-governance-contract";

import {
  type TargetFieldBinding,
  type TargetFields,
  useStopTargetDraft,
} from "../../behavior/use-stop-target-draft.ts";
import { STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";

type Option = { value: string; label: string };

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

/** The fields one target kind asks for. */
function TargetKindFields({
  kind,
  databricksSources,
  awsConnections,
  field,
}: {
  kind: AgentStopTargetKind;
  databricksSources: readonly Option[];
  awsConnections: readonly Option[];
  field: (name: keyof TargetFields) => TargetFieldBinding;
}) {
  return (
    <>
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
    </>
  );
}

const KIND_OPTIONS: Option[] = AGENT_STOP_TARGET_KINDS.map((kind) => ({
  value: kind,
  label: STOP_TARGET_KIND_LABELS[kind],
}));

/**
 * One new plan target of any kind, checked against the contract before it joins the plan. Add is
 * off while `disabled`, so a typed target is never cleared by an add that does not land.
 */
export function StopTargetForm({
  databricksSources,
  awsConnections,
  onAdd,
  disabled,
}: {
  databricksSources: readonly Option[];
  awsConnections: readonly Option[];
  onAdd: (target: AgentStopTarget) => void;
  disabled: boolean;
}) {
  const draft = useStopTargetDraft({ onAdd });

  return (
    <VStack align="stretch" gap={3} data-testid="stop-target-form">
      <OptionSelect
        label="Target kind"
        options={KIND_OPTIONS}
        value={draft.kind}
        placeholder="Pick a kind"
        onChange={draft.pickKind}
      />
      <TargetKindFields
        kind={draft.kind}
        databricksSources={databricksSources}
        awsConnections={awsConnections}
        field={draft.field}
      />
      {draft.error ? (
        <Text textStyle="sm" color="fg.error" role="alert">
          {draft.error}
        </Text>
      ) : null}
      <HStack justify="end">
        <Button size="sm" variant="outline" onClick={draft.add} disabled={disabled}>
          Add target
        </Button>
      </HStack>
    </VStack>
  );
}
