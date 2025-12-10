import { Button, HStack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "~/server/filters/types";
import { FieldsFilters } from "./filters/FieldsFilters";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { Drawer } from "./ui/drawer";

export function SeriesFiltersDrawer({
  onClose,
  filters: formFilters,
  onChange,
}: {
  onClose?: () => void;
  filters: Record<FilterField, FilterParam>;
  onChange: ({
    filters,
  }: {
    filters: Record<FilterField, FilterParam>;
  }) => void;
}) {
  const { closeDrawer } = useDrawer();
  const onClose_ = onClose ?? closeDrawer;

  const [filters, setFilters] = useState(formFilters);

  useEffect(() => {
    setFilters(formFilters);
  }, [formFilters]);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Edit Series Filter
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <HorizontalFormControl
            label="Current filters"
            helper="Add or remove filters to the analytics series."
            minWidth="calc(50% - 16px)"
          >
            <FieldsFilters
              filters={filters}
              setFilters={(filters) => {
                const updatedFilters = Object.fromEntries(
                  Object.entries(filters).filter(
                    ([_, value]) => value !== undefined,
                  ),
                ) as Record<FilterField, FilterParam>;
                onChange({
                  filters: updatedFilters,
                });
                setFilters(updatedFilters);
              }}
            />
          </HorizontalFormControl>

          <HStack justifyContent="flex-end" marginY={5}>
            <Button
              colorPalette="blue"
              type="submit"
              minWidth="fit-content"
              onClick={onClose_}
            >
              Done
            </Button>
          </HStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
