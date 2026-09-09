/**
 * The score metrics a project's reviewers can use, at `/settings/annotation-scores`.
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
import { Link } from "../elements/annotation-link.tsx";
import { NoDataInfoBlock } from "../elements/no-data-info-block.tsx";
import { AnnotationScoreDataType } from "../../model/annotation-score-data-type.ts";
import { annotationScoresApi } from "../../behavior/annotation-scores-api.ts";
import { useAnnotationScoresHost } from "../../model/annotation-scores-host.ts";

/** The grant the platform page asked for, unchanged. */
export const ANNOTATION_SCORES_PAGE_PERMISSION = "annotations:view";

type AnnotationScore = {
  id: string;
  name: string;
  description: string | null;
  dataType: string | null;
  options: unknown;
  active: boolean;
};

function AnnotationScoresTable({
  scores,
  isLoading,
  canManage,
  onToggle,
  onEdit,
  onDelete,
}: {
  scores: readonly AnnotationScore[] | undefined;
  isLoading: boolean;
  canManage: boolean;
  onToggle: (score: AnnotationScore) => void;
  onEdit: (scoreId: string) => void;
  onDelete: (scoreId: string) => void;
}) {
  return (
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
          {isLoading ? (
            <LoadingScoreRows colSpan={canManage ? 6 : 5} />
          ) : (
            scores?.map((score) => (
              <AnnotationScoreRow
                key={score.id}
                score={score}
                canManage={canManage}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

function LoadingScoreRows({ colSpan }: { colSpan: number }) {
  return Array.from({ length: 3 }, (_, index) => (
    <Table.Row key={index}>
      <Table.Cell colSpan={colSpan}>
        <Skeleton height="20px" />
      </Table.Cell>
    </Table.Row>
  ));
}

function AnnotationScoreRow({
  score,
  canManage,
  onToggle,
  onEdit,
  onDelete,
}: {
  score: AnnotationScore;
  canManage: boolean;
  onToggle: (score: AnnotationScore) => void;
  onEdit: (scoreId: string) => void;
  onDelete: (scoreId: string) => void;
}) {
  return (
    <Table.Row>
      <Table.Cell>{score.name}</Table.Cell>
      <Table.Cell>{score.description}</Table.Cell>
      <Table.Cell width="20%">
        <Text lineClamp={1}>
          {score.dataType === AnnotationScoreDataType.CHECKBOX ? "Checkbox" : "Multiple choice"}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <ScoreOptions options={Array.isArray(score.options) ? score.options : []} />
      </Table.Cell>
      <Table.Cell textAlign="center">
        <Switch
          checked={score.active}
          disabled={!canManage}
          onCheckedChange={() => onToggle(score)}
        />
      </Table.Cell>
      {canManage && (
        <Table.Cell>
          <ScoreActions scoreId={score.id} onEdit={onEdit} onDelete={onDelete} />
        </Table.Cell>
      )}
    </Table.Row>
  );
}

function ScoreActions({
  scoreId,
  onEdit,
  onDelete,
}: {
  scoreId: string;
  onEdit: (scoreId: string) => void;
  onDelete: (scoreId: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost">
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={() => onEdit(scoreId)}>
          <Box display="flex" alignItems="center" gap={2}>
            <Edit size={14} />
            Edit
          </Box>
        </Menu.Item>
        <Menu.Item value="delete" onClick={() => onDelete(scoreId)}>
          <Box display="flex" alignItems="center" gap={2} color="red.600">
            <Trash size={14} />
            Delete
          </Box>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

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
        onError: (error) => host.failed({ error, fallbackTitle: "Failed to update score" }),
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
          onError: (error) => host.failed({ error, fallbackTitle: "Failed to delete score" }),
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
        {getAllAnnotationScores.data?.length === 0 ? (
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
          <AnnotationScoresTable
            scores={getAllAnnotationScores.data}
            isLoading={getAllAnnotationScores.isLoading}
            canManage={canManage}
            onToggle={(score) => handleToggleScore(score.id, !score.active)}
            onEdit={(scoreId) => host.openEditor(scoreId)}
            onDelete={handleDeleteScore}
          />
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

const ScoreOptions = ({ options }: { options: unknown[] }) => {
  const visibleOptions = options.filter(
    (option): option is { label: string; value: number } =>
      typeof option === "object" && option !== null && "label" in option && "value" in option,
  );

  return (
    <HStack flexWrap="wrap" gap={4}>
      {visibleOptions.map((option) => (
        <Badge key={option.value}>{option.label}</Badge>
      ))}
    </HStack>
  );
};
