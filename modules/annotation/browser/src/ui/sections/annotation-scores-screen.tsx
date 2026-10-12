/**
 * The score metrics a project's reviewers can use, at `/settings/annotation-scores`.
 */

import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { Edit, Plus, ThumbsUp, Trash } from "lucide-react";
import { useEffect, useState } from "react";

import { annotationScoresApi } from "../../behavior/annotation-scores-api.ts";
import { useScoreSettings } from "../../behavior/use-annotation-score-settings.ts";
import { AnnotationScoreDataType } from "../../model/annotation-score-data-type.ts";
import { useAnnotationScoresHost } from "../../model/annotation-scores-host.ts";

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
    <Box width="full">
      <ListTable scroll="x" scrollLabel="Annotation scores" loading={isLoading}>
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Score Type</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Score Options</ListTable.ColumnHeader>
            <ListTable.ColumnHeader width="fit">Enabled</ListTable.ColumnHeader>
            {canManage && <ListTable.ActionHeader />}
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {isLoading ? (
            <ListTable.LoadingRows rows={3} columns={canManage ? 5 : 4} />
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
        </ListTable.Body>
      </ListTable>
    </Box>
  );
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
    <ListTable.Row data-testid={`annotation-score-row-${score.name}`}>
      <ListTable.Cell>
        <VStack align="start" gap={0.5}>
          <Text fontWeight="medium">{score.name}</Text>
          {score.description && (
            <Text fontSize="sm" color="fg.muted" lineClamp={2}>
              {score.description}
            </Text>
          )}
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell width="20%">
        <Text lineClamp={1}>
          {score.dataType === AnnotationScoreDataType.CHECKBOX ? "Checkbox" : "Multiple choice"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <ScoreOptions options={Array.isArray(score.options) ? score.options : []} />
      </ListTable.Cell>
      <ListTable.Cell align="center">
        <Switch
          checked={score.active}
          disabled={!canManage}
          onCheckedChange={() => onToggle(score)}
        />
      </ListTable.Cell>
      {canManage && (
        <ListTable.ActionCell>
          <ScoreActions
            scoreId={score.id}
            scoreName={score.name}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </ListTable.ActionCell>
      )}
    </ListTable.Row>
  );
}

function ScoreActions({
  scoreId,
  scoreName,
  onEdit,
  onDelete,
}: {
  scoreId: string;
  scoreName: string;
  onEdit: (scoreId: string) => void;
  onDelete: (scoreId: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Actions for score ${scoreName}`}>
          <MoreVerticalIcon />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={() => onEdit(scoreId)}
          data-testid="annotation-score-action-edit"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Edit size={14} />
            Edit
          </Box>
        </Menu.Item>
        <Menu.Item
          value="delete"
          onClick={() => onDelete(scoreId)}
          data-testid="annotation-score-action-delete"
        >
          <Box display="flex" alignItems="center" gap={2} color="fg.error">
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

  const getAllAnnotationScores = useScoreSettings({ projectId: project?.id });

  const toggleAnnotationScore = annotationScoresApi.annotationScore.toggle.useMutation();

  const isAnnotationDrawerOpen = host.editor().open;

  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scoreToDelete, setScoreToDelete] = useState<string | null>(null);

  const deleteAnnotationScore = annotationScoresApi.annotationScore.delete.useMutation();

  const { refetch: refetchAnnotationScores } = getAllAnnotationScores;
  const projectId = project?.id;
  // refetch() ignores `enabled`, so it waits for the project like the query does.
  useEffect(() => {
    if (!projectId) return;
    void refetchAnnotationScores();
  }, [projectId, isAnnotationDrawerOpen, refetchAnnotationScores]);

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
      <PageLayout.Header>
        <PageLayout.Heading>Annotation Scores</PageLayout.Heading>
        <Spacer />
        {canManage && getAllAnnotationScores.data?.length !== 0 && (
          <PageLayout.HeaderButton
            primary
            onClick={() => host.openEditor()}
            data-testid="annotation-score-add"
          >
            <Plus /> Add new score metric
          </PageLayout.HeaderButton>
        )}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          The score metrics reviewers fill in when they annotate a trace.
        </Text>
        {getAllAnnotationScores.data?.length === 0 ? (
          <Box width="full">
            <NoDataInfoBlock
              title="No scoring setup yet"
              description="Add new scoring metrics for your annotations."
              docsInfo={
                <Text>
                  To learn more about scores and how to use them, please visit our{" "}
                  <Link
                    color="orange.fg"
                    href="https://docs.langwatch.ai/annotations/scores"
                    isExternal
                  >
                    documentation
                  </Link>
                  .
                </Text>
              }
              icon={<ThumbsUp />}
            >
              {canManage && (
                <PageLayout.HeaderButton
                  primary
                  onClick={() => host.openEditor()}
                  data-testid="annotation-score-empty-add"
                >
                  <Plus /> Add new score metric
                </PageLayout.HeaderButton>
              )}
            </NoDataInfoBlock>
          </Box>
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
    <HStack flexWrap="wrap" gap={2}>
      {visibleOptions.map((option) => (
        <Badge key={option.value}>{option.label}</Badge>
      ))}
    </HStack>
  );
};
