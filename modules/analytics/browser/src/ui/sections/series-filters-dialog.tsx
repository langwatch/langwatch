/**
 * The filters one SERIES of a custom graph is narrowed by, mounted INLINE
 * — this family's own overlay with exactly one opener, so no
 * `setFlowCallbacks` side channel: `onChange` is just a prop here.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

import type { FilterField } from "../../model/analytics-filter-definition.ts";
import type { FilterParam } from "../../model/analytics-filter-params.ts";
import { FieldsFilters } from "./fields-filters.tsx";

const emptyFilters = {} as Record<FilterField, FilterParam>;

export function SeriesFiltersDialog({
  open,
  onOpenChange,
  filters: seriesFilters,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters?: Record<FilterField, FilterParam>;
  onChange: (input: { filters: Record<FilterField, FilterParam> }) => void;
}) {
  const filters = seriesFilters ?? emptyFilters;

  return (
    <Dialog
      open={open}
      size="lg"
      onClose={() => onOpenChange(false)}
      title="Edit series filter"
      cancelLabel={null}
      primaryAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      <VStack align="start" gap={3}>
        <Text textStyle="sm" color="fg.muted">
          Add or remove filters for this analytics series.
        </Text>
        <FieldsFilters
          filters={filters}
          setFilters={(next) => {
            const updated = Object.fromEntries(
              Object.entries(next).filter(([, value]) => value !== void 0),
            ) as Record<FilterField, FilterParam>;
            onChange({ filters: updated });
          }}
        />
      </VStack>
    </Dialog>
  );
}
