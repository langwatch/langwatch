import type { SortField } from "./types";

// Cost + Tokens previously had columns here but the span tree payload
// never carries those numbers (they live on the heavier per-span detail
// query), so the cells were always empty dashes — pure noise. We drop
// them; the per-span drawer surfaces tokens/cost when you select a row.
export const COLUMNS: {
  field: SortField;
  label: string;
  width: string;
  flex?: number;
  align?: "left" | "right" | "center";
  mono?: boolean;
}[] = [
  { field: "name", label: "Name", width: "auto", flex: 1, mono: true },
  { field: "type", label: "Type", width: "72px" },
  {
    field: "duration",
    label: "Duration",
    width: "76px",
    align: "right",
    mono: true,
  },
  { field: "model", label: "Model", width: "100px" },
  { field: "status", label: "", width: "32px", align: "center" },
  { field: "start", label: "Start", width: "72px", align: "right", mono: true },
];
