import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  HStack,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useDrawer } from "~/components/CurrentDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { FilterField } from "~/server/filters/types";
import { FieldsFilters } from "./filters/FieldsFilters";
import { useRouter } from "next/router";

export function EditTriggerFilterDrawer({ triggerId }: { triggerId?: string }) {
  const { project } = useOrganizationTeamProject();

  const toast = useToast();
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
      toast({
        title: "Error",
        description: "Please add at least one filter",
        status: "error",
        position: "top-right",
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
          toast({
            title: "Trigger Updated",
            description: `You have successfully updated the trigger`,

            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });

          void queryClient.trigger.getTriggers.invalidate();
          clearFilters();
          void router.replace({
            pathname: router.pathname,
            query: { project: router.query.project },
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Error updating trigger",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"lg"}
      onClose={closeDrawer}
      onOverlayClick={closeDrawer}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Edit Trigger Filter
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <HorizontalFormControl
            label="Current filters"
            helper="Add or remove filters to the trigger."
            minWidth="calc(50% - 16px)"
          >
            <FieldsFilters />
          </HorizontalFormControl>

          <HStack justifyContent="flex-end" marginY={5}>
            <Button
              colorScheme="blue"
              type="submit"
              minWidth="fit-content"
              isLoading={updateTriggerFilters.isLoading}
              onClick={onSubmit}
            >
              Update Filters
            </Button>
          </HStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
