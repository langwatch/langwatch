import {
  Badge,
  Button,
  Code,
  Input,
  Inline,
  Panel,
  SegmentedControl,
  Stack,
  Table,
  Text,
  type BadgeTone,
  type TableColumn,
} from "@langwatch/design-system-internal";
import type { ReactNode } from "react";

import type { Limit } from "../shared/contract.ts";
import {
  areasOf,
  isSwitch,
  labelOf,
  parseDraft,
  rangeOf,
  SOURCE_LABELS,
  type Change,
} from "./limits.ts";

const SOURCE_TONES: Record<Limit["source"], BadgeTone> = {
  default: "neutral",
  settings: "neutral",
  ".env": "warn",
  env: "warn",
};

const SWITCH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

/** The applies sentence, its backtick spans set as inline code. */
const appliesOf = ({ limit }: { limit: Limit }): ReactNode =>
  `Applies ${limit.applies}`
    .split("`")
    .map((part, index) => (index % 2 === 1 ? <Code key={index}>{part}</Code> : part));

const helpOf = ({ limit }: { limit: Limit }) => {
  const standard = isSwitch({ limit })
    ? `default ${limit.default === 1 ? "on" : "off"}`
    : `default ${limit.default} · ${rangeOf({ limit })}`;
  const wins = limit.source === "env" || limit.source === ".env";
  return wins ? `${standard} · set in ${SOURCE_LABELS[limit.source]}, which wins` : standard;
};

const ValueCell = ({
  limit,
  text,
  onChange,
  onSave,
}: {
  limit: Limit;
  text: string | undefined;
  onChange: (text: string) => void;
  onSave: (input: { changes: Change[] }) => void;
}) => {
  const label = labelOf({ limit });
  const help = (
    <Text as="div" size="xs" tone="muted">
      {helpOf({ limit })}
    </Text>
  );
  if (isSwitch({ limit })) {
    return (
      <Stack gap={1}>
        <SegmentedControl
          size="sm"
          label={label}
          options={SWITCH_OPTIONS}
          value={limit.value === 1 ? "1" : "0"}
          onChange={(next) => {
            const value = Number(next);
            if (value !== limit.value) onSave({ changes: [{ limit, value }] });
          }}
        />
        {help}
      </Stack>
    );
  }
  const shown = text ?? String(limit.value);
  const value = parseDraft({ limit, text: shown });
  const dirty = text !== undefined && value !== undefined && value !== limit.value;
  return (
    <Stack gap={1}>
      <Inline gap={2} align="start">
        <div className="haven-unit-field">
          <Input
            label={label}
            hideLabel
            size="sm"
            mono
            type="number"
            min={limit.allowZero ? 0 : limit.min}
            max={limit.max}
            value={shown}
            error={value === undefined ? `Use ${rangeOf({ limit })}` : undefined}
            onChange={onChange}
          />
          <span className="haven-unit-field-unit">{limit.unit}</span>
        </div>
        {dirty && (
          <Button size="sm" onClick={() => onSave({ changes: [{ limit, value }] })}>
            Save
          </Button>
        )}
      </Inline>
      {help}
    </Stack>
  );
};

/** The machine's limits by area: one row each, saved per row or together from the page. */
export const LimitsForm = ({
  limits,
  drafts,
  onDraft,
  onSave,
}: {
  limits: Limit[];
  drafts: Record<string, string>;
  onDraft: (input: { name: string; text: string | undefined }) => void;
  onSave: (input: { changes: Change[] }) => void;
}) => {
  const columns: TableColumn<Limit>[] = [
    {
      key: "setting",
      header: "Setting",
      cell: (limit) => (
        <>
          <Text as="div" weight="medium">
            {labelOf({ limit })}
          </Text>
          <Text as="div" size="xs" tone="muted">
            {appliesOf({ limit })}
          </Text>
        </>
      ),
    },
    {
      key: "value",
      header: "Value",
      width: "300px",
      cell: (limit) => (
        <ValueCell
          limit={limit}
          text={drafts[limit.name]}
          onChange={(text) => onDraft({ name: limit.name, text })}
          onSave={onSave}
        />
      ),
    },
    {
      key: "source",
      header: "Source",
      width: "180px",
      align: "end",
      cell: (limit) =>
        limit.source === "default" ? null : (
          <Inline gap={2} justify="end">
            <Badge tone={SOURCE_TONES[limit.source]} title={limit.env}>
              {SOURCE_LABELS[limit.source]}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              title={`Back to the default, ${limit.default} ${limit.unit}`}
              onClick={() => onSave({ changes: [{ limit, value: limit.default }] })}
            >
              Use default
            </Button>
          </Inline>
        ),
    },
  ];
  return (
    <>
      {areasOf({ limits }).map((area) => (
        <Panel key={area.title} title={area.title}>
          <Table
            columns={columns}
            rows={area.limits}
            rowKey={(limit) => limit.name}
            caption={`${area.title} limits`}
          />
        </Panel>
      ))}
    </>
  );
};
