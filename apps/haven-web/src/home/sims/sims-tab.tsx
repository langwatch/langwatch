import {
  Badge,
  Button,
  Callout,
  Code,
  Inline,
  KeyValue,
  Panel,
  Stack,
  StatusDot,
  Table,
  Tabs,
  type TableColumn,
} from "@langwatch/design-system-internal";

import { simRowSchema, type SimRow } from "../../shared/contract.ts";
import { useCliRows } from "../../shared/use-cli-rows.ts";

const ALL = "";

const columns: TableColumn<SimRow>[] = [
  { key: "name", header: "Simulator", mono: true, width: "120px", cell: (sim) => sim.name },
  {
    key: "state",
    header: "State",
    width: "120px",
    cell: (sim) =>
      sim.running ? (
        <StatusDot state="live" label="Running" />
      ) : (
        <StatusDot state="down" label="Off" />
      ),
  },
  {
    key: "where",
    header: "Console / start",
    mono: true,
    cell: (sim) => (sim.running ? (sim.console ?? "") : (sim.start ?? "")),
  },
];

const SimPanel = ({ sim }: { sim: SimRow }) => (
  <Panel
    title={sim.name}
    meta={sim.running ? "running" : "off"}
    actions={
      sim.running &&
      sim.console !== undefined && (
        <Button size="sm" variant="primary" href={sim.console}>
          Open console
        </Button>
      )
    }
  >
    <Stack gap={3}>
      {!sim.running && (
        <Callout title="Not running in this stack">
          Start it with <Code>{sim.start ?? `haven up +${sim.name}`}</Code>.
        </Callout>
      )}
      <KeyValue
        items={[
          { label: "Console", value: sim.console ?? "—", copy: sim.console ?? false },
          { label: "Skill", value: sim.skill, copy: sim.skill },
        ]}
      />
      <Inline gap={1}>
        {(sim.verbs ?? []).map((verb) => (
          <Badge key={verb}>{verb}</Badge>
        ))}
      </Inline>
    </Stack>
  </Panel>
);

/** The Sims tab: `haven sim` for this stack, one sub-tab per running simulator. */
export const SimsTab = ({
  slug,
  sub,
  onSub,
}: {
  slug: string;
  sub: string;
  onSub: (sub: string) => void;
}) => {
  const sims = useCliRows({ slug, name: "sims", row: simRowSchema });
  const rows = sims.data ?? [];
  const running = rows.filter((sim) => sim.running);
  const open = rows.find((sim) => sim.name === sub);
  if (sims.error !== undefined && sims.data === undefined) {
    return (
      <Callout tone="error" title="The simulators could not be read">
        {sims.error}
      </Callout>
    );
  }
  return (
    <Stack gap={4}>
      <Tabs
        label="Simulators"
        tabs={[
          { id: ALL, label: "All", count: running.length },
          ...running.map((sim) => ({ id: sim.name, label: sim.name })),
        ]}
        value={open === undefined ? ALL : open.name}
        onChange={onSub}
      />
      {open === undefined ? (
        <Panel title="Simulators" meta={`${running.length} of ${rows.length} running`}>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(sim) => sim.name}
            caption="Simulators of this stack"
            empty="Reading the simulators…"
            onRowClick={(sim) => onSub(sim.name)}
          />
        </Panel>
      ) : (
        <SimPanel sim={open} />
      )}
    </Stack>
  );
};
