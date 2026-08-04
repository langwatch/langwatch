import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

type Scenario = {
  labels: string[];
};

/**
 * Hook for managing label-based filtering of scenarios.
 * Extracts unique labels from scenarios and manages filter state.
 */
export function useLabelFilter(scenarios: Scenario[] | undefined) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const allLabels = useMemo(() => {
    if (!scenarios) return [];
    const labels = new Set<string>();
    scenarios.forEach((s) => s.labels.forEach((l) => labels.add(l)));
    return Array.from(labels).sort();
  }, [scenarios]);

  const activeLabels = useMemo(() => {
    const labelsFilter = columnFilters.find((f) => f.id === "labels");
    return (labelsFilter?.value as string[]) ?? [];
  }, [columnFilters]);

  const handleLabelToggle = useCallback((label: string) => {
    setColumnFilters((prev) => {
      const labelsFilter = prev.find((f) => f.id === "labels");
      const currentLabels = (labelsFilter?.value as string[]) ?? [];
      const newLabels = currentLabels.includes(label)
        ? currentLabels.filter((l) => l !== label)
        : [...currentLabels, label];

      const otherFilters = prev.filter((f) => f.id !== "labels");
      if (newLabels.length === 0) return otherFilters;
      return [...otherFilters, { id: "labels", value: newLabels }];
    });
  }, []);

  return {
    columnFilters,
    setColumnFilters,
    allLabels,
    activeLabels,
    handleLabelToggle,
  };
}
