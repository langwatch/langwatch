import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Menu,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AnnotationScoreDataType } from "@prisma/client";
import { EyeOff, Filter, MoreVertical, Plus, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";

import { useEffect, useState } from "react";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import { api } from "../../utils/api";
import { DeleteConfirmationDialog } from "../../components/annotations/DeleteConfirmationDialog";

const AnnotationScorePage = () => {
  const { project } = useOrganizationTeamProject();

  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();

  const getAllAnnotationScores = api.annotationScore.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const toggleAnnotationScore = api.annotationScore.toggle.useMutation();

  const isAnnotationDrawerOpen = isDrawerOpen("addOrEditAnnotationScore");

  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scoreToDelete, setScoreToDelete] = useState<string | null>(null);

  const deleteAnnotationScore = api.annotationScore.delete.useMutation();

  useEffect(() => {
    void getAllAnnotationScores.refetch();
  }, [isAnnotationDrawerOpen]);

  const handleToggleScore = (scoreId: string, active: boolean) => {
    toggleAnnotationScore.mutate(
      { scoreId, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void getAllAnnotationScores.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Update score",
            type: "error",
            description: "Failed to update score",
            duration: 6000,
            meta: {
              closable: true,
            },
          });
        },
      }
    );
  };

  const handleDeleteScore = (scoreId: string) => {
    setScoreToDelete(scoreId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteScore = () => {
    if (scoreToDelete) {
      deleteAnnotationScore.mutate(
        { scoreId: scoreToDelete, projectId: project?.id ?? "" },
        {
          onSuccess: () => {
            void getAllAnnotationScores.refetch();

            toaster.create({
              title: "Delete score",
              type: "success",
              description: "Score deleted successfully",
              duration: 6000,
              meta: {
                closable: true,
              },
            });
          },
          onError: () => {
            toaster.create({
              title: "Delete score",
              type: "error",
              description: "Failed to delete score",
              duration: 6000,
              meta: {
                closable: true,
              },
            });
          },
        }
      );
    }
    setDeleteDialogOpen(false);
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="6xl"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Annotation Scoring
          </Heading>
          <Spacer />
          <Button
            size="sm"
            colorPalette="orange"
            onClick={() => openDrawer("addOrEditAnnotationScore")}
          >
            <Plus size={20} /> Add new score metric
          </Button>
        </HStack>
        <Card.Root width="full">
          <Card.Body>
            {getAllAnnotationScores.data &&
            getAllAnnotationScores.data.length == 0 ? (
              <NoDataInfoBlock
                title="No scoring setup yet"
                description="Add new scoring metrics for your annotations."
                docsInfo={
                  <Text>
                    To learn more about scores and how to use them, please visit
                    our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/features/annotations#annotation-scoring"
                      isExternal
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<ThumbsUp />}
              />
            ) : (
              <Table.Root variant="line" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Name</Table.ColumnHeader>
                    <Table.ColumnHeader>Description</Table.ColumnHeader>
                    <Table.ColumnHeader>Score Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Score Options</Table.ColumnHeader>
                    <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                    <Table.ColumnHeader>Actions</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {getAllAnnotationScores.data?.map((score) => (
                    <Table.Row key={score.id}>
                      <Table.Cell>{score.name}</Table.Cell>
                      <Table.Cell>{score.description}</Table.Cell>
                      <Table.Cell width="20%">
                        <Text lineClamp={1}>
                          {score.dataType === AnnotationScoreDataType.CHECKBOX
                            ? "Checkbox"
                            : "Multiple choice"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <ScoreOptions
                          options={
                            Array.isArray(score.options)
                              ? (score.options as {
                                  label: string;
                                  value: number;
                                }[])
                              : []
                          }
                          dataType={score.dataType ?? ""}
                        />
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        <Switch
                          checked={score.active}
                          onCheckedChange={() => {
                            handleToggleScore(score.id, !score.active);
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant={"ghost"}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            >
                              <MoreVertical />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDrawer("addOrEditAnnotationScore", {
                                  annotationScoreId: score.id,
                                  onClose: () => {},
                                  onOverlayClick: () => {},
                                });
                              }}
                            >
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={2}
                              >
                                <Filter size={14} />
                                Edit Filters
                              </Box>
                            </Menu.Item>
                            <Menu.Item
                              value="delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteScore(score.id);
                              }}
                            >
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={2}
                                color="red.600"
                              >
                                <EyeOff size={14} />
                                Delete
                              </Box>
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>
      </VStack>
      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDeleteScore}
      />
    </SettingsLayout>
  );
};

export default AnnotationScorePage;

const ScoreOptions = ({
  options,
  dataType,
}: {
  options: { label: string; value: number }[];
  dataType: string;
}) => {
  return (
    <>
      {dataType === "CHECKBOX" ? (
        <HStack>
          <HStack flexWrap="wrap" gap={4}>
            {options.map((option) => (
              <Badge key={option.value}>{option.label}</Badge>
            ))}
          </HStack>
        </HStack>
      ) : (
        <HStack>
          <HStack flexWrap="wrap" gap={4}>
            {options.map((option) => (
              <Badge key={option.value}>{option.label}</Badge>
            ))}
          </HStack>
        </HStack>
      )}
    </>
  );
};
