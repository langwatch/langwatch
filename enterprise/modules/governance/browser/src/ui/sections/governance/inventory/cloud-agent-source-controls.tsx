// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The controls a cloud agent source asks with: an AWS connection picker that can add one inline,
 * region chips, and project/location rows. Each holds one string in the form's state.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import { Card } from "@langwatch/design-system/card";
import {
  Button,
  HStack,
  IconButton,
  Input,
  TagsInput,
  Text,
  VStack,
  Wrap,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { DashboardSelect } from "../../../../features/ingestion-sources/dashboard-select.tsx";
import { AwsConnectionForm, useAwsConnections } from "../../../../features/kill-switch/index.ts";
import {
  isAwsRegion,
  isVertexTarget,
  parseRegions,
  parseTargets,
  serializeRegions,
  serializeTargets,
  type VertexTargetRow,
} from "./cloud-agent-pull-config.ts";
import type { CustomControlRenderer } from "./parser-field-controls.ts";

/** Regions where Bedrock Agents run, offered as one-click additions. */
const COMMON_BEDROCK_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-northeast-1",
  "ap-southeast-2",
] as const;

const MAX_REGIONS = 20;
const MAX_TARGETS = 20;

function FieldComplaint({ children, testId }: { children: string; testId: string }) {
  return (
    <Text fontSize="xs" color="red.fg" data-testid={testId}>
      {children}
    </Text>
  );
}

type ControlProps = {
  value: string;
  onChange: (next: string) => void;
  isInvalid: boolean;
  readOnly: boolean;
};

/** Picks one of the organisation's AWS connections, or adds one without leaving the drawer. */
function AwsConnectionPicker({
  organizationId,
  value,
  onChange,
  isInvalid,
  readOnly,
}: ControlProps & { organizationId: string }) {
  const { connections, isLoading, error, retry } = useAwsConnections({ organizationId });
  const [isAdding, setAdding] = useState(false);

  if (error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load AWS connections"
        onRetry={retry}
      />
    );
  }

  if (isAdding) {
    return (
      <Card padding="sm">
        <AwsConnectionForm
          organizationId={organizationId}
          onDone={(created) => {
            setAdding(false);
            if (created) onChange(created.id);
          }}
        />
      </Card>
    );
  }

  const options = connections.map((connection) => ({
    value: connection.id,
    label: connection.roleArn
      ? `${connection.name} (role)`
      : `${connection.name} (key ending ${connection.accessKeyIdLastFour ?? "****"})`,
  }));
  return (
    <VStack align="stretch" gap={2} data-testid="aws-connection-picker">
      {connections.length > 0 || isLoading ? (
        <DashboardSelect
          ariaLabel="AWS connection"
          options={options}
          value={value}
          onChange={onChange}
          placeholder={isLoading ? "Loading connections" : "Pick a connection"}
          disabled={isLoading || readOnly}
          invalid={isInvalid}
        />
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No AWS connection yet. Add one to let this source sign in.
        </Text>
      )}
      {!readOnly && (
        <HStack>
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={12} />
            Add AWS connection
          </Button>
        </HStack>
      )}
    </VStack>
  );
}

/** Region codes as chips, each checked against the adapter's own pattern before it is added. */
function AwsRegionsInput({ value, onChange, isInvalid, readOnly }: ControlProps) {
  const regions = parseRegions(value);
  /** The typed value the chip check refused; typing something else clears the complaint. */
  const [refused, setRefused] = useState<string | null>(null);
  const setRegions = (next: readonly string[]) => onChange(serializeRegions(next));
  const stale = regions.filter((region) => !isAwsRegion(region));
  const suggestions = COMMON_BEDROCK_REGIONS.filter((region) => !regions.includes(region));
  const isFull = regions.length >= MAX_REGIONS;

  return (
    <VStack align="stretch" gap={2}>
      <TagsInput.Root
        size="sm"
        value={regions}
        onValueChange={(details) => {
          setRefused(null);
          setRegions(details.value.map((region) => region.trim()));
        }}
        onInputValueChange={({ inputValue }) => {
          // The chips clear a refused value a frame later; only new typing clears the complaint.
          const typed = inputValue.trim();
          if (typed && typed !== refused) setRefused(null);
        }}
        validate={(details) => {
          const candidate = details.inputValue.trim();
          if (isAwsRegion(candidate)) return true;
          setRefused(candidate);
          return false;
        }}
        max={MAX_REGIONS}
        addOnPaste
        delimiter=","
        blurBehavior="add"
        readOnly={readOnly}
        invalid={isInvalid || !!refused || stale.length > 0}
      >
        <TagsInput.Control>
          <TagsInput.Items />
          <TagsInput.Input aria-label="Regions" placeholder="Type a region and press Enter" />
        </TagsInput.Control>
      </TagsInput.Root>
      {refused && (
        <FieldComplaint testId="aws-regions-refused">
          Use a region code such as eu-west-1.
        </FieldComplaint>
      )}
      {stale.length > 0 && (
        <FieldComplaint testId="aws-regions-stale">
          {`${stale.join(", ")} ${stale.length === 1 ? "is not a region code" : "are not region codes"}. Remove ${stale.length === 1 ? "it" : "them"} to save.`}
        </FieldComplaint>
      )}
      {!readOnly && !isFull && suggestions.length > 0 && (
        <Wrap gap={1}>
          {suggestions.map((region) => (
            <Button
              key={region}
              size="xs"
              variant="ghost"
              onClick={() => setRegions([...regions, region])}
            >
              <Plus size={10} />
              {region}
            </Button>
          ))}
        </Wrap>
      )}
    </VStack>
  );
}

/** One row per Google Cloud project and location the source lists reasoning engines in. */
function VertexTargetRows({ value, onChange, isInvalid, readOnly }: ControlProps) {
  const held = parseTargets(value);
  const rows: VertexTargetRow[] = held.length > 0 ? held : [{ projectId: "", location: "" }];
  const write = (next: readonly VertexTargetRow[]) => onChange(serializeTargets(next));
  const update = (index: number, patch: Partial<VertexTargetRow>) =>
    write(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <VStack align="stretch" gap={2} data-testid="vertex-target-rows">
      {rows.map((row, index) => {
        const isBlank = !row.projectId.trim() && !row.location.trim();
        const isWrong = !isBlank && !isVertexTarget(row);
        return (
          <VStack key={index} align="stretch" gap={1}>
            <HStack gap={2}>
              <Input
                size="sm"
                aria-label={`Project ${index + 1}`}
                placeholder="acme-ml"
                value={row.projectId}
                readOnly={readOnly}
                aria-invalid={isWrong || (isInvalid && isBlank) || undefined}
                onChange={(e) => update(index, { projectId: e.target.value })}
              />
              <Input
                size="sm"
                aria-label={`Location ${index + 1}`}
                placeholder="europe-west4"
                value={row.location}
                readOnly={readOnly}
                aria-invalid={isWrong || (isInvalid && isBlank) || undefined}
                onChange={(e) => update(index, { location: e.target.value })}
              />
              {!readOnly && rows.length > 1 && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove project ${index + 1}`}
                  onClick={() => write(rows.filter((_, i) => i !== index))}
                >
                  <X size={14} />
                </IconButton>
              )}
            </HStack>
            {isWrong && (
              <FieldComplaint testId={`vertex-target-error-${index}`}>
                Enter a project id and a location such as europe-west4.
              </FieldComplaint>
            )}
          </VStack>
        );
      })}
      {!readOnly && rows.length < MAX_TARGETS && (
        <HStack>
          <Button
            size="xs"
            variant="outline"
            onClick={() => write([...rows, { projectId: "", location: "" }])}
          >
            <Plus size={12} />
            Add project
          </Button>
        </HStack>
      )}
    </VStack>
  );
}

/** The renderer the composer and the edit drawer hand to `ParserConfigFields`. */
export function cloudAgentCustomControl({
  organizationId,
}: {
  organizationId: string;
}): CustomControlRenderer {
  return function CloudAgentControl({ field, value, onChange, isInvalid, readOnly }) {
    const props = { value, onChange, isInvalid, readOnly };
    if (field.key === "awsConnectionId") {
      return <AwsConnectionPicker organizationId={organizationId} {...props} />;
    }
    if (field.key === "regions") return <AwsRegionsInput {...props} />;
    if (field.key === "targets") return <VertexTargetRows {...props} />;
    return null;
  };
}
