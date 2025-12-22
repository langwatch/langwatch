import { createContext, useContext } from "react";
import type { Table } from "@tanstack/react-table";



export const DataGridContext = createContext<{
  table: Table<any> | null;
}>({
  table: null,
});

export function useDataGridContext<TData>() {
  const context = useContext(DataGridContext);
  if (!context) throw new Error("DataGridContext not found");
  return context as {
    table: Table<TData> | null;
  };
}
