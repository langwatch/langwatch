import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { DiscoveredFoldProjection } from "../discovery";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReplayConfig {
  projections: DiscoveredFoldProjection[];
  since: string;
  concurrency: number;
  dryRun: boolean;
}

interface ReplayWizardProps {
  tenantId: string;
  projectInfo: { name: string; slug: string } | null;
  availableProjections: DiscoveredFoldProjection[];
  initialProjections?: DiscoveredFoldProjection[];
  initialSince?: string;
  initialConcurrency?: number;
  initialDryRun?: boolean;
  onComplete: (config: ReplayConfig) => void;
  onCancel: () => void;
}

type WizardStep = "projections" | "since" | "concurrency" | "dryRun";

function getSteps(props: ReplayWizardProps): WizardStep[] {
  const steps: WizardStep[] = [];
  if (!props.initialProjections) steps.push("projections");
  if (props.initialSince === undefined) steps.push("since");
  if (props.initialConcurrency === undefined) steps.push("concurrency");
  if (props.initialDryRun === undefined) steps.push("dryRun");
  return steps;
}

// ─── ProjectionPicker ───────────────────────────────────────────────────────

function ProjectionPicker({
  projections,
  onComplete,
  onCancel,
}: {
  projections: DiscoveredFoldProjection[];
  onComplete: (selected: DiscoveredFoldProjection[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(projections.length - 1, c + 1));
    } else if (input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) {
          next.delete(cursor);
        } else {
          next.add(cursor);
        }
        return next;
      });
    } else if (key.return) {
      if (selected.size === 0) return;
      const result = projections.filter((_, i) => selected.has(i));
      onComplete(result);
    }
  });

  const maxName = Math.max(...projections.map((p) => p.projectionName.length));

  return (
    <Box flexDirection="column">
      <Text bold>Select projections</Text>
      <Text dimColor>space to toggle, enter to confirm, esc to cancel</Text>
      <Text dimColor>{"━".repeat(56)}</Text>
      {projections.map((p, i) => {
        const isSelected = selected.has(i);
        const isCursor = i === cursor;
        const source = p.source === "global" ? "global" : p.pipelineName;
        const check = isSelected ? "x" : " ";
        const name = p.projectionName.padEnd(maxName);
        return (
          <Text key={p.projectionName}>
            {isCursor ? <Text color="cyan">{"> "}</Text> : "  "}
            <Text>{`[${check}] `}</Text>
            <Text bold={isSelected}>{name}</Text>
            <Text dimColor>{`  (${source})`}</Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>{selected.size} selected</Text>
      </Box>
    </Box>
  );
}

// ─── SinceInput ─────────────────────────────────────────────────────────────

function SinceInput({
  onComplete,
  onCancel,
}: {
  onComplete: (since: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      onComplete(trimmed);
    }
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Since date </Text>
        <Text dimColor>(YYYY-MM-DD): </Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
      {value.trim().length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && (
        <Text color="yellow">  Format: YYYY-MM-DD</Text>
      )}
    </Box>
  );
}

// ─── ConcurrencyInput ───────────────────────────────────────────────────────

function ConcurrencyInput({
  onComplete,
  onCancel,
}: {
  onComplete: (concurrency: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("10");

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = (val: string) => {
    const num = parseInt(val.trim(), 10);
    if (!isNaN(num) && num > 0) {
      onComplete(num);
    }
  };

  return (
    <Box>
      <Text bold>Concurrency </Text>
      <Text dimColor>[10]: </Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  );
}

// ─── DryRunToggle ───────────────────────────────────────────────────────────

function DryRunToggle({
  onComplete,
  onCancel,
}: {
  onComplete: (dryRun: boolean) => void;
  onCancel: () => void;
}) {
  const [enabled, setEnabled] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (input === " ") {
      setEnabled((v) => !v);
    } else if (key.return) {
      onComplete(enabled);
    }
  });

  return (
    <Box>
      <Text bold>Dry run? </Text>
      <Text>{`[${enabled ? "x" : " "}]`}</Text>
      <Text dimColor> space to toggle, enter to confirm</Text>
    </Box>
  );
}

// ─── ReplayWizard ───────────────────────────────────────────────────────────

export function ReplayWizard(props: ReplayWizardProps) {
  const {
    tenantId,
    projectInfo,
    availableProjections,
    initialProjections,
    initialSince,
    initialConcurrency,
    initialDryRun,
    onComplete,
    onCancel,
  } = props;

  const steps = getSteps(props);
  const [stepIndex, setStepIndex] = useState(0);

  const [projections, setProjections] = useState<DiscoveredFoldProjection[]>(
    initialProjections ?? [],
  );
  const [since, setSince] = useState(initialSince ?? "");
  const [concurrency, setConcurrency] = useState(initialConcurrency ?? 10);
  const [dryRun, setDryRun] = useState(initialDryRun ?? false);

  const currentStep = steps[stepIndex];

  const advance = () => {
    if (stepIndex + 1 >= steps.length) {
      onComplete({
        projections,
        since,
        concurrency,
        dryRun,
      });
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const projectDisplay = projectInfo
    ? `${projectInfo.name} (${tenantId})`
    : `${tenantId} (not found in DB)`;

  return (
    <Box flexDirection="column">
      <Text bold>Projection Replay</Text>
      <Text>{"━".repeat(50)}</Text>

      <Box marginLeft={2} marginTop={1} flexDirection="column">
        <Text>
          <Text dimColor>project </Text>
          <Text>{projectDisplay}</Text>
        </Text>
      </Box>

      <Box marginLeft={2} marginTop={1}>
        {currentStep === "projections" && (
          <ProjectionPicker
            projections={availableProjections}
            onComplete={(selected) => {
              setProjections(selected);
              advance();
            }}
            onCancel={onCancel}
          />
        )}

        {currentStep === "since" && (
          <SinceInput
            onComplete={(val) => {
              setSince(val);
              advance();
            }}
            onCancel={onCancel}
          />
        )}

        {currentStep === "concurrency" && (
          <ConcurrencyInput
            onComplete={(val) => {
              setConcurrency(val);
              advance();
            }}
            onCancel={onCancel}
          />
        )}

        {currentStep === "dryRun" && (
          <DryRunToggle
            onComplete={(val) => {
              setDryRun(val);
              advance();
            }}
            onCancel={onCancel}
          />
        )}

        {currentStep === undefined && (
          <Text dimColor>Preparing...</Text>
        )}
      </Box>
    </Box>
  );
}
