import {
  Code,
  Link,
  Panel,
  StatusDot,
  Table,
  type TableColumn,
} from "@langwatch/design-system-internal";

import type { Surface } from "../shared/contract.ts";
import { surfaceState } from "../shared/surfaces.ts";

const columns: TableColumn<Surface>[] = [
  {
    key: "status",
    header: "Status",
    width: "136px",
    cell: (surface) => <StatusDot {...surfaceState({ status: surface.status })} />,
  },
  {
    key: "name",
    header: "Surface",
    width: "136px",
    title: (surface) => surface.role,
    cell: (surface) => surface.name,
  },
  {
    key: "hostname",
    header: "Hostname",
    mono: true,
    hideOnNarrow: true,
    title: (surface) => surface.url || surface.hostname || surface.role,
    cell: (surface) => {
      if (surface.url === "") return surface.hostname || "no hostname";
      return (
        <Link href={surface.url} mono>
          {surface.hostname || surface.url}
        </Link>
      );
    },
  },
  {
    key: "port",
    header: "Port",
    width: "72px",
    align: "end",
    mono: true,
    muted: true,
    cell: (surface) => (surface.port === 0 ? "—" : String(surface.port)),
  },
  {
    key: "hint",
    header: "To turn on",
    width: "232px",
    hideOnNarrow: true,
    title: (surface) => surface.hint,
    cell: (surface) => (surface.hint === "" ? null : <Code>{surface.hint}</Code>),
  },
];

/** Every surface the stack can have, in launch order, with its status and address. */
export const SurfacesPanel = ({ surfaces }: { surfaces: Surface[] }) => {
  const selected = surfaces.filter((surface) => surface.status !== "not-selected");
  const live = selected.filter((surface) => surface.status === "live").length;
  return (
    <Panel title="Surfaces" meta={`${live} of ${selected.length} live`}>
      <Table
        columns={columns}
        rows={surfaces}
        rowKey={(surface) => surface.name}
        caption="Surfaces of this stack"
      />
    </Panel>
  );
};
