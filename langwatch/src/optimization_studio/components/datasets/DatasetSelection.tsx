import { DeleteIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Heading,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useState, useTransition } from "react";
import { MoreHorizontal, Plus } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { DEFAULT_DATASET_NAME } from "../../../components/datasets/DatasetTable";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../../server/api/root";
import { api } from "../../../utils/api";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry } from "../../types/dsl";
import { useDrawer } from "../../../components/CurrentDrawer";

export function DatasetSelection({
  node,
  setIsEditing,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
  setIsEditing: (isEditing: Entry["dataset"] | undefined) => void;
}) {
  const { project } = useOrganizationTeamProject();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const { openDrawer } = useDrawer();

  return (
    <VStack align="start" spacing={12}>
      <VStack align="start" spacing={4}>
        <HStack spacing={6}>
          <Heading size="md">Current Dataset</Heading>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openDrawer("uploadCSV", {
                onSuccess: ({ datasetId, name }) => {
                  setIsEditing({
                    id: datasetId,
                    name,
                  });
                },
                onCreateFromScratch: () => {
                  openDrawer("addOrEditDataset", {
                    onSuccess: ({ datasetId, name }) => {
                      setIsEditing({
                        id: datasetId,
                        name,
                      });
                    },
                  });
                },
              });
            }}
            leftIcon={<Plus size={14} />}
          >
            New dataset
          </Button>
        </HStack>
        <DatasetSelectionItem
          query={datasets}
          dataset={(node.data as Entry).dataset}
          onClick={() => {
            setIsEditing((node.data as Entry).dataset);
          }}
        />
      </VStack>
      <VStack align="start" spacing={4}>
        <Heading size="md">Datasets</Heading>
        <HStack spacing={4} wrap="wrap">
          {datasets.data?.map((storedDataset) => {
            const dataset = {
              id: storedDataset.id,
              name: storedDataset.name,
            };

            return (
              <DatasetSelectionItem
                query={datasets}
                key={dataset.id}
                dataset={dataset}
                onClick={() => {
                  setIsEditing(dataset);
                }}
              />
            );
          })}
        </HStack>
      </VStack>
    </VStack>
  );
}

export function DatasetSelectionItem({
  query,
  dataset,
  onClick,
}: {
  query: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["dataset"]["getAll"],
    TRPCClientErrorLike<AppRouter>
  >;
  dataset: Entry["dataset"];
  onClick: () => void;
}) {
  const { rows, columns } = useGetDatasetData({ dataset, preview: true });

  // Add random delay to render the dataset previews because too many of them
  // at once causes the page to hang, blocking the javascript thread
  const [rendered, setRendered] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, startTransition] = useTransition();
  useEffect(() => {
    setTimeout(
      () => {
        startTransition(() => {
          setRendered(true);
        });
      },
      100 + Math.floor(Math.random() * 200)
    );
  }, []);

  const { project } = useOrganizationTeamProject();
  const toast = useToast();
  const datasetDelete = api.dataset.deleteById.useMutation();

  const deleteDataset = (id: string, name: string) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          void query.refetch();
          toast({
            title: `Dataset ${name} deleted`,
            description: (
              <HStack>
                <Button
                  colorScheme="white"
                  variant="link"
                  textDecoration="underline"
                  onClick={() => {
                    toast.close(`delete-dataset-${id}`);
                    setTimeout(() => {
                      void query.refetch();
                    }, 1000);
                    datasetDelete.mutate(
                      {
                        projectId: project?.id ?? "",
                        datasetId: id,
                        undo: true,
                      },
                      {
                        onSuccess: () => {
                          void query.refetch();
                          toast({
                            title: "Dataset restored",
                            description: "The dataset has been restored.",
                            status: "success",
                            duration: 5000,
                            isClosable: true,
                            position: "top-right",
                          });
                        },
                      }
                    );
                  }}
                >
                  Undo
                </Button>
              </HStack>
            ),
            id: `delete-dataset-${id}`,
            status: "success",
            duration: 10_000,
            isClosable: true,
            position: "top-right",
          });
        },
        onError: () => {
          toast({
            title: "Failed to delete dataset",
            description:
              "There was an error deleting the dataset. Please try again.",
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
    <VStack
      align="start"
      width="300px"
      border="1px solid"
      borderRadius="8px"
      borderColor="gray.350"
      background="#F5F7F7"
      className="ag-borderless"
      position="relative"
    >
      {dataset?.id && (
        <Box position="absolute" top={0} right={0} zIndex={11}>
          <Menu>
            <MenuButton
              as={Button}
              paddingX={1}
              paddingY={1}
              minHeight="0"
              height="auto"
              minWidth="0"
              // variant={"ghost"}
              color="gray.400"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <MoreHorizontal />
            </MenuButton>
            <MenuList>
              <MenuItem
                color="red.600"
                onClick={(event) => {
                  event.stopPropagation();

                  deleteDataset(dataset?.id ?? "", dataset?.name ?? "");
                }}
                icon={<DeleteIcon />}
              >
                Delete dataset
              </MenuItem>
            </MenuList>
          </Menu>
        </Box>
      )}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        role="button"
        aria-label="Select dataset"
        onClick={onClick}
        zIndex={10}
      />
      <Box width="100%" height="178px" background="#F5F7F7">
        {rendered && (
          <DatasetPreview
            rows={rows}
            columns={columns.map((column) => ({
              name: column.name,
              type: "string",
            }))}
            borderRadius="6px 6px 0 0"
          />
        )}
      </Box>
      <Text fontSize="14px" fontWeight="bold" padding={4}>
        {dataset?.name ?? DEFAULT_DATASET_NAME}
      </Text>
    </VStack>
  );
}
