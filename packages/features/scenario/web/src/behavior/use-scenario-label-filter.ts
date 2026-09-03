import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function useScenarioLabelFilter(scenarios: { labels: string[] }[] | undefined) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const allLabels = useMemo(() => {
    if (!scenarios) {
      return [];
    }

    const labels = new Set<string>();
    for (const scenario of scenarios) {
      for (const label of scenario.labels) {
        labels.add(label);
      }
    }
    return [...labels].sort();
  }, [scenarios]);

  const activeLabels = useMemo(() => {
    const labelsFilter = columnFilters.find((filter) => filter.id === "labels");
    if (!labelsFilter) {
      return [];
    }

    return stringArray(labelsFilter.value);
  }, [columnFilters]);

  const handleLabelToggle = useCallback((label: string) => {
    setColumnFilters((currentFilters) => {
      const labelsFilter = currentFilters.find((filter) => filter.id === "labels");
      const selectedLabels = stringArray(labelsFilter?.value);
      const nextLabels = selectedLabels.includes(label)
        ? selectedLabels.filter((selectedLabel) => selectedLabel !== label)
        : [...selectedLabels, label];
      const otherFilters = currentFilters.filter((filter) => filter.id !== "labels");

      return nextLabels.length === 0
        ? otherFilters
        : [...otherFilters, { id: "labels", value: nextLabels }];
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
