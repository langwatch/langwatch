import type { JsonValue } from "../utils/json";

/**
 * The CustomGraph row as the automations domain speaks it — one field per
 * scalar column of the Prisma `CustomGraph` model, no `@prisma/client`
 * dependency. Pinned against the generated type by the app-side parity test.
 */
export interface CustomGraphRow {
  id: string;
  projectId: string;
  name: string;
  graph: JsonValue;
  filters: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}
