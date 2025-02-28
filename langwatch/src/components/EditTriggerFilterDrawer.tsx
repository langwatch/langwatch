import { Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useDrawer } from "~/components/CurrentDrawer";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FilterField } from "~/server/filters/types";
import { api } from "~/utils/api";
import { Drawer } from "../components/ui/drawer";
import { toaster } from "../components/ui/toaster";
import { FieldsFilters } from "./filters/FieldsFilters";
import { HorizontalFormControl } from "./HorizontalFormControl";

export function EditTriggerFilterDrawer({ triggerId }: { triggerId?: string }) {
  const { project } = useOrganizationTeamProject();

  const updateTriggerFilters = api.trigger.updateTriggerFilters.useMutation();
  const { getLatestFilters, clearFilters, setFilters } = useFilterParams();
  const router = useRouter();

  const queryClient = api.useContext();

  api.trigger.getTriggerById.useQuery(
    {
      triggerId: triggerId ?? "",
      projectId: project?.id ?? "",
    },
    {
      onSuccess: (data) => {
        const filters = JSON.parse(data?.filters as string) as Record<
          string,
          string[] | Record<string, string[]>
        >;
        const filtersToSet = Object.entries(filters).reduce(
          (acc, [key, value]) => {
            if (Array.isArray(value)) {
              if (value.length > 0) {
                acc[key as FilterField] = value;
              }
            } else if (typeof value === "object" && value !== null) {
              acc[key as FilterField] = value;
            }
            return acc;
          },
          {} as Record<FilterField, string[] | Record<string, string[]>>
        );

        setFilters(filtersToSet);
      },
    }
  );

  const { closeDrawer } = useDrawer();

  const onSubmit = () => {
    const filterParams = getLatestFilters();
    if (
      Object.values(filterParams.filters).every((values) => values.length === 0)
    ) {
      toaster.create({
        title: "Error",
        description: "Please add at least one filter",
        type: "error",
        placement: "top-end",
        meta: {
          closable: true,
        },
      });
      return;
    }

    updateTriggerFilters.mutate(
      {
        projectId: project?.id ?? "",
        triggerId: triggerId ?? "",
        filters: Object.fromEntries(
          Object.entries(filterParams.filters).filter(([_, value]) =>
            Array.isArray(value)
              ? value.length > 0
              : Object.keys(value as Record<string, string[]>).length > 0
          )
        ),
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Trigger Updated",
            description: `You have successfully updated the trigger`,
            type: "success",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });

          void queryClient.trigger.getTriggers.invalidate();
          clearFilters();
          void router.replace({
            pathname: router.pathname,
            query: { project: router.query.project },
          });
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description: "Error updating trigger",
            type: "error",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
        },
      }
    );
  };

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
              Edit Trigger Filter
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <HorizontalFormControl
            label="Current filters"
            helper="Add or remove filters to the trigger."
            minWidth="calc(50% - 16px)"
          >
            <FieldsFilters />
          </HorizontalFormControl>

          <HStack justifyContent="flex-end" marginY={5}>
            <Button
              colorPalette="blue"
              type="submit"
              minWidth="fit-content"
              loading={updateTriggerFilters.isLoading}
              onClick={onSubmit}
            >
              Update Filters
            </Button>
          </HStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
