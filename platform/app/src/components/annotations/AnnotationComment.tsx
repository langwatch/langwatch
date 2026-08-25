import { Box, Button, Input, Text } from "@chakra-ui/react";
import {
  AnnotationCommentCard,
  AnnotationCommentEditor,
  AnnotationScoringDisabled,
  readAnnotationScoreOptions,
} from "@langwatch/annotation-web";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useAnnotationCommentStore } from "~/hooks/useAnnotationCommentStore";
import { useAnnotationInvalidation } from "~/hooks/useAnnotationInvalidation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { RandomColorAvatar } from "../RandomColorAvatar";
import { UserAvatar } from "../UserAvatar";
import { toaster } from "../ui/toaster";

type Annotation = {
  isThumbsUp?: string | null;
  comment?: string | null;
  scoreOptions?: Record<string, { value: string | string[]; reason: string }>;
};

/** App container for annotation transport, state and feedback. */
export function AnnotationComment({ key = "" }: { key: string }) {
  const { project, isPublicRoute } = useOrganizationTeamProject();
  const commentState = useAnnotationCommentStore();
  const { traceId, action, annotationId, expectedOutput } = commentState;
  const queryClient = api.useUtils();
  const session = useSession();
  const createAnnotation = api.annotation.create.useMutation();
  const deleteAnnotation = api.annotation.deleteById.useMutation();
  const updateAnnotation = api.annotation.updateByTraceId.useMutation();
  const getAnnotationScoring = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && !isPublicRoute },
  );
  const getAnnotation = api.annotation.getById.useQuery({
    projectId: project?.id ?? "",
    annotationId: annotationId ?? "",
  });
  const { id } = getAnnotation.data ?? { comment: "", scoreOptions: {} };
  const { register, handleSubmit, watch, setValue, reset } = useForm<Annotation>({
    defaultValues: { comment: "", scoreOptions: {} },
  });

  useEffect(() => {
    if (getAnnotation.data) {
      reset({
        comment: getAnnotation.data.comment ?? "",
        scoreOptions: readAnnotationScoreOptions(getAnnotation.data.scoreOptions),
      });
      return;
    }
    if (action === "new") {
      reset({ comment: "", scoreOptions: {} });
    }
  }, [getAnnotation.data, action, reset]);

  const invalidateAnnotationReads = useAnnotationInvalidation({ traceId: traceId ?? "" });

  const onSubmit = (data: Annotation) => {
    const scoreOptions = Object.fromEntries(
      Object.entries(data.scoreOptions ?? {}).filter(
        ([, value]) =>
          value.value !== "" &&
          value.value !== null &&
          (typeof value.value === "boolean" ? value.value : true) &&
          (Array.isArray(value.value) ? value.value.length > 0 : true),
      ),
    );

    if (action === "edit") {
      updateAnnotation.mutate(
        {
          id: id ?? "",
          projectId: project?.id ?? "",
          comment: data.comment,
          traceId: traceId ?? "",
          scoreOptions,
          expectedOutput: expectedOutput ?? "",
        },
        {
          onSuccess: () => {
            invalidateAnnotationReads();
            void queryClient.annotation.getAll.invalidate();
            toaster.create({
              title: "Annotation Updated",
              description: "You have successfully updated the annotation",
              type: "success",
            });
            reset();
            commentState.resetComment();
          },
          onError: () => {
            toaster.create({
              title: "Error",
              description: "Error updating annotation",
              type: "error",
            });
          },
        },
      );
      return;
    }

    createAnnotation.mutate(
      {
        projectId: project?.id ?? "",
        comment: data.comment,
        traceId: traceId ?? "",
        scoreOptions,
        expectedOutput: expectedOutput ?? "",
      },
      {
        onSuccess: () => {
          invalidateAnnotationReads();
          toaster.create({
            title: "Annotation Created",
            description: "You have successfully created an annotation",
            type: "success",
          });
          reset();
          commentState.resetComment();
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description: "Error creating annotation",
            type: "error",
          });
        },
      },
    );
  };

  const handleDelete = () => {
    deleteAnnotation.mutate(
      { annotationId: id ?? "", projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          invalidateAnnotationReads();
          toaster.create({
            title: "Annotation Deleted",
            description: "You have successfully deleted an annotation",
            type: "success",
          });
          commentState.resetComment();
        },
      },
    );
  };

  const scores = getAnnotationScoring.data ?? [];
  const scoreOptions = watch("scoreOptions") ?? {};

  return (
    <Box
      width="full"
      onClick={(event) => event.stopPropagation()}
      key={key}
      minWidth={380}
    >
      <AnnotationCommentCard>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <AnnotationCommentEditor
            loading={getAnnotation.isLoading}
            loadingActor={
              <RandomColorAvatar
                size="sm"
                name={session.data?.user.name ?? ""}
                image={session.data?.user.image}
              />
            }
            actor={
              <>
                <UserAvatar
                  size="sm"
                  name={session.data?.user.name ?? ""}
                  image={session.data?.user.image}
                />
                <Text>{session.data?.user.name}</Text>
              </>
            }
            mode={action ?? "new"}
            commentInput={
              <Input
                {...register("comment")}
                autoFocus={action === "new"}
                placeholder={action === "new" ? "Leave your comment here" : ""}
              />
            }
            scores={scores.map((score) => ({
              id: score.id,
              name: score.name,
              options: score.options,
              description: score.description,
              dataType: score.dataType,
              defaultValue: score.defaultValue,
            }))}
            scoreOptions={scoreOptions}
            onScoreValueChange={(scoreTypeId, value) =>
              setValue(`scoreOptions.${scoreTypeId}.value`, value)
            }
            onScoreReasonChange={(scoreTypeId, reason) =>
              setValue(`scoreOptions.${scoreTypeId}.reason`, reason)
            }
            onCancel={() => {
              reset();
              commentState.resetComment();
            }}
            onDelete={handleDelete}
            deleting={deleteAnnotation.isPending || getAnnotation.isLoading}
            saving={
              createAnnotation.isPending ||
              updateAnnotation.isPending ||
              getAnnotation.isLoading
            }
            scoringDisabled={
              <AnnotationScoringDisabled>
                <Link href="/settings/annotation-scores">
                  <Button colorPalette="blue" minWidth="fit-content" size="sm">
                    Enable scoring metrics
                  </Button>
                </Link>
              </AnnotationScoringDisabled>
            }
          />
        </form>
      </AnnotationCommentCard>
    </Box>
  );
}
