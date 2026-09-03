/**
 * The score metrics a project's reviewers can use, at
 * `/settings/annotation-scores`.
 *
 * ONE TABLE OVER ONE READ, and two writes a lite member never sees: a switch
 * that stops offering a definition without touching what has already been
 * scored against it, and a delete that removes it. The editor opens over the
 * page as an overlay whose ADDRESS is a query key, so a link to a definition
 * being edited is a link somebody else can open.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Switch } from "@langwatch/design-system/switch";
import { Edit, MoreVertical, Plus, ThumbsUp, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "../../ui/elements/annotation-link";
import { NoDataInfoBlock } from "../../ui/elements/no-data-info-block";
import { AnnotationScoreDataType } from "./annotation-score-data-type";
import { annotationScoresApi } from "./annotation-scores-api";
import { useAnnotationScoresHost } from "./annotation-scores-host";

/** The grant the platform page asked for, unchanged. */
export const ANNOTATION_SCORES_PAGE_PERMISSION = "annotations:view";

export default function AnnotationScoresScreen() {
  const host = useAnnotationScoresHost();
  const project = host.project();
  const canManage = !host.isLiteMember();

  const getAllAnnotationScores = annotationScoresApi.annotationScore.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project },
  );

  const toggleAnnotationScore = annotationScoresApi.annotationScore.toggle.useMutation();

  const isAnnotationDrawerOpen = host.editor().open;

  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scoreToDelete, setScoreToDelete] = useState<string | null>(null);

  const deleteAnnotationScore = annotationScoresApi.annotationScore.delete.useMutation();

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
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Failed to update score" }),
      },
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
            host.succeeded({
              title: "Delete score",
              description: "Score deleted successfully",
            });
          },
          onError: (error) =>
            host.failed({ error, fallbackTitle: "Failed to delete score" }),
        },
      );
    }
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Annotation Scoring</Heading>
          <Spacer />
          {canManage && (
            <PageLayout.HeaderButton onClick={() => host.openEditor()}>
              <Plus /> Add new score metric
            </PageLayout.HeaderButton>
          )}
        </HStack>
        {getAllAnnotationScores.data && getAllAnnotationScores.data.length == 0 ? (
          <NoDataInfoBlock
            title="No scoring setup yet"
            description="Add new scoring metrics for your annotations."
            docsInfo={
              <Text>
                To learn more about scores and how to use them, please visit our{" "}
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
          <Box width="full" overflowX="auto">
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Description</Table.ColumnHeader>
                  <Table.ColumnHeader>Score Type</Table.ColumnHeader>
                  <Table.ColumnHeader>Score Options</Table.ColumnHeader>
                  <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                  {canManage && <Table.ColumnHeader>Actions</Table.ColumnHeader>}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {getAllAnnotationScores.isLoading ? (
                  <>
                    <Table.Row>
                      <Table.Cell colSpan={canManage ? 6 : 5}>
                        <Skeleton height="20px" />
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell colSpan={canManage ? 6 : 5}>
                        <Skeleton height="20px" />
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell colSpan={canManage ? 6 : 5}>
                        <Skeleton height="20px" />
                      </Table.Cell>
                    </Table.Row>
                  </>
                ) : (
                  getAllAnnotationScores.data?.map((score) => {
                    return (
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
                            disabled={!canManage}
                            onCheckedChange={() => {
                              handleToggleScore(score.id, !score.active);
                            }}
                          />
                        </Table.Cell>
                        {canManage && (
                          <Table.Cell>
                            <Menu.Root>
                              <Menu.Trigger asChild>
                                <Button variant={"ghost"}>
                                  <MoreVertical />
                                </Button>
                              </Menu.Trigger>
                              <Menu.Content>
                                <Menu.Item
                                  value="edit"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    host.openEditor(score.id);
                                  }}
                                >
                                  <Box display="flex" alignItems="center" gap={2}>
                                    <Edit size={14} />
                                    Edit
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
                                    <Trash size={14} />
                                    Delete
                                  </Box>
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Root>
                          </Table.Cell>
                        )}
                      </Table.Row>
                    );
                  })
                )}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </VStack>
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(false);
        }}
        title="Delete score metric"
        message="The scores already recorded against it stay readable; reviewers will no longer be offered it."
        confirmLabel="Delete"
        loading={deleteAnnotationScore.isPending}
        onConfirm={confirmDeleteScore}
      />
    </>
  );
}

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
