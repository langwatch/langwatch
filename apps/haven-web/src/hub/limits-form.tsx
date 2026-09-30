import {
  Badge,
  Button,
  Input,
  Panel,
  SegmentedControl,
  Table,
  Text,
  type BadgeTone,
  type TableColumn,
} from "@langwatch/design-system-internal";

import type { Limit } from "../shared/contract.ts";
import { areasOf, isSwitch, labelOf, parseDraft, rangeOf, SOURCE_LABELS } from "./limits.ts";

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

const helpOf = ({ limit }: { limit: Limit }) => {
  const standard = isSwitch({ limit })
    ? `${limit.default === 1 ? "On" : "Off"} by default`
    : `Default ${limit.default} ${limit.unit} · ${rangeOf({ limit })}`;
  const wins = limit.source === "env" || limit.source === ".env";
  return wins ? `${standard} · set in ${SOURCE_LABELS[limit.source]}, which wins` : standard;
};

const ValueCell = ({
  limit,
  text,
  onChange,
}: {
  limit: Limit;
  text: string;
  onChange: (text: string) => void;
}) => {
  const label = labelOf({ limit });
  if (isSwitch({ limit })) {
    return (
      <SegmentedControl
        size="sm"
        label={label}
        options={SWITCH_OPTIONS}
        value={text === "1" ? "1" : "0"}
        onChange={onChange}
      />
    );
  }
  const invalid = parseDraft({ limit, text }) === undefined;
  return (
    <div className="haven-unit-field">
      <Input
        label={label}
        hideLabel
        size="sm"
        mono
        type="number"
        min={limit.allowZero ? 0 : limit.min}
        max={limit.max}
        value={text}
        error={invalid ? `Use ${rangeOf({ limit })}` : undefined}
        onChange={onChange}
      />
      <span className="haven-unit-field-unit">{limit.unit}</span>
    </div>
  );
};

/** The machine's limits by area: one row each, edited in place and saved together. */
export const LimitsForm = ({
  limits,
  drafts,
  onDraft,
}: {
  limits: Limit[];
  drafts: Record<string, string>;
  onDraft: (input: { name: string; text: string | undefined }) => void;
}) => {
  const textOf = ({ limit }: { limit: Limit }) => drafts[limit.name] ?? String(limit.value);
  const columns: TableColumn<Limit>[] = [
    {
      key: "setting",
      header: "Setting",
      title: (limit) => `Applies ${limit.applies}`,
      cell: (limit) => (
        <>
          <Text as="div" weight="medium">
            {labelOf({ limit })}
          </Text>
          <Text as="div" size="xs" tone="muted">
            {helpOf({ limit })}
          </Text>
        </>
      ),
    },
    {
      key: "value",
      header: "Value",
      width: "220px",
      cell: (limit) => (
        <ValueCell
          limit={limit}
          text={textOf({ limit })}
          onChange={(text) => onDraft({ name: limit.name, text })}
        />
      ),
    },
    {
      key: "source",
      header: "Source",
      width: "116px",
      hideOnNarrow: true,
      cell: (limit) => (
        <Badge tone={SOURCE_TONES[limit.source]} title={limit.env}>
          {SOURCE_LABELS[limit.source]}
        </Badge>
      ),
    },
    {
      key: "reset",
      header: "",
      width: "84px",
      align: "end",
      cell: (limit) =>
        textOf({ limit }) === String(limit.default) ? null : (
          <Button
            size="sm"
            variant="ghost"
            title={`Back to the default, ${limit.default} ${limit.unit}`}
            onClick={() => onDraft({ name: limit.name, text: String(limit.default) })}
          >
            Reset
          </Button>
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
