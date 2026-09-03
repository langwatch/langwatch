/**
 * The filters one SERIES of a custom graph is narrowed by.
 *
 * `platform/app`'s `SeriesFiltersDrawer`, mounted INLINE by the builder rather
 * than through the drawer registry — the gateway family's routing-policy shape,
 * applied to this family's own overlay. It had exactly one opener, so the
 * registry entry is deleted with it.
 *
 * THE CALLBACK REGISTRATION IS GONE, AND THAT IS THE POINT. The platform
 * version was opened through `openDrawer("seriesFilters", …)` after a separate
 * `setFlowCallbacks("seriesFilters", { onChange })` — a registry-wide side
 * channel for handing a component a function, because the address can only
 * carry strings. Mounted inline, `onChange` is just a prop.
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Dialog } from "@langwatch/design-system/dialog";

import type { FilterField } from "../../model/analytics-filter-definition";
import type { FilterParam } from "../../model/analytics-filter-params";
import { FieldsFilters } from "./fields-filters";

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
  const [filters, setFilters] = useState(seriesFilters ?? emptyFilters);

  useEffect(() => {
    setFilters(seriesFilters ?? emptyFilters);
  }, [seriesFilters]);

  return (
    <Dialog.Root open={open} size="lg" onOpenChange={({ open: isOpen }) => onOpenChange(isOpen)}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Edit series filter</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
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
                setFilters(updated);
              }}
            />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack justifyContent="flex-end" width="full">
            <Button colorPalette="blue" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
