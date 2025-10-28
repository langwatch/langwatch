import {
  Avatar,
  Box,
  Button,
  Card,
  Fieldset,
  HStack,
  Input,
  Separator,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";

import { Menu } from "../ui/menu";
import { Popover } from "../ui/popover";
import { Checkbox, CheckboxGroup } from "../ui/checkbox";
import { Radio, RadioGroup } from "../ui/radio";

import { ChevronDown, MoreVertical, Trash2 } from "react-feather";

import type { AnnotationScoreDataType } from "@prisma/client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useForm,
  type UseFormSetValue,
  type UseFormWatch,
} from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { useSession } from "next-auth/react";
import { useAnnotationCommentStore } from "~/hooks/useAnnotationCommentStore";
import { ScoreReasonModal } from "../ScoreReasonModal";
import { toaster } from "../ui/toaster";
import { RandomColorAvatar } from "../RandomColorAvatar";

type Annotation = {
  isThumbsUp?: string | null;
  comment?: string | null;
  scoreOptions?: Record<string, { value: string | string[]; reason: string }>;
};

let doNotCloseMenu = false;

export function AnnotationComment({ key = "" }: { key: string }) {
  const { project, isPublicRoute } = useOrganizationTeamProject();
  const commentState = useAnnotationCommentStore();
  const { traceId, action, annotationId, expectedOutput } = commentState;

  const queryClient = api.useContext();

  const session = useSession();

  const createAnnotation = api.annotation.create.useMutation();
  const deleteAnnotation = api.annotation.deleteById.useMutation();

  const getAnnotationScoring = api.annotationScore.getAllActive.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !isPublicRoute,
    },
  );

  const getAnnotation = api.annotation.getById.useQuery({
    projectId: project?.id ?? "",
    annotationId: annotationId ?? "",
  });

  const updateAnnotation = api.annotation.updateByTraceId.useMutation();

  const { id } = getAnnotation.data ?? {
    comment: "",
    scoreOptions: {},
  };

  const { register, handleSubmit, watch, setValue, reset } =
    useForm<Annotation>({
      defaultValues: {
        comment: "",
        scoreOptions: {},
      },
    });

  // Set form values when data is available
  useEffect(() => {
    if (getAnnotation.data) {
      reset({
        comment: getAnnotation.data.comment ?? "",
        scoreOptions:
          (getAnnotation.data.scoreOptions as Record<
            string,
            { value: string | string[]; reason: string }
          >) ?? {},
      });
    } else if (action === "new") {
      reset({
        comment: "",
        scoreOptions: {},
      });
    }
  }, [getAnnotation.data, action]);

  const onSubmit = (data: Annotation) => {
    const filteredScoreOptions = Object.fromEntries(
      Object.entries(data.scoreOptions ?? {}).filter(
        ([_, value]) =>
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
          scoreOptions: filteredScoreOptions,
          expectedOutput: expectedOutput ?? "",
        },
        {
          onSuccess: () => {
            void queryClient.annotation.getByTraceId.invalidate();
            void queryClient.annotation.getAll.invalidate();

            toaster.create({
              title: "Annotation Updated",
              description: `You have successfully updated the annotation`,
              type: "success",
              meta: {
                closable: true,
              },
            });

            reset();

            commentState.resetComment();
          },
          onError: () => {
            toaster.create({
              title: "Error",
              description: "Error updating annotation",
              type: "error",
              meta: {
                closable: true,
              },
            });
          },
        },
      );
    } else {
      createAnnotation.mutate(
        {
          projectId: project?.id ?? "",
          comment: data.comment,
          traceId: traceId ?? "",
          scoreOptions: filteredScoreOptions,
          expectedOutput: expectedOutput ?? "",
        },
        {
          onSuccess: () => {
            void queryClient.annotation.getByTraceId.invalidate();

            toaster.create({
              title: "Annotation Created",
              description: `You have successfully created an annotation`,
              type: "success",
              meta: {
                closable: true,
              },
            });

            reset();
            commentState.resetComment();
          },
          onError: () => {
            toaster.create({
              title: "Error",
              description: "Error creating annotation",
              type: "error",
              meta: {
                closable: true,
              },
            });
          },
        },
      );
    }
  };

  const handleDelete = () => {
    deleteAnnotation.mutate(
      {
        annotationId: id ?? "",
        projectId: project?.id ?? "",
      },
      {
        onSuccess: () => {
          void queryClient.annotation.getByTraceId.invalidate();

          toaster.create({
            title: "Annotation Deleted",
            description: `You have successfully deleted the annotation`,
            type: "success",
            meta: {
              closable: true,
            },
          });
          commentState.resetComment();
        },
      },
    );
  };
  const scoreReasonModal = useDisclosure();
  const [selectedScoreTypeId, setSelectedScoreTypeId] = useState<string | null>(
    null,
  );

  const handleReasonClick = (scoreTypeId: string) => {
    setSelectedScoreTypeId(scoreTypeId);
    scoreReasonModal.onOpen();
  };

  const selectedReason = selectedScoreTypeId
    ? watch(`scoreOptions.${selectedScoreTypeId}`)?.reason ?? ""
    : "";

  const { open, setOpen } = useDisclosure();

  useEffect(() => {
    doNotCloseMenu = false;
  }, [open]);

  return (
    <Box
      width="full"
      onClick={(e) => e.stopPropagation()}
      key={key}
      minWidth={380}
    >
      <Card.Root>
        <Card.Body>
          {getAnnotation.isLoading ? (
            <VStack align="start" gap={3} width="full">
              <HStack>
                <Skeleton>
                  <RandomColorAvatar
                    size="sm"
                    name={session.data?.user.name ?? ""}
                  />
                </Skeleton>
                <Skeleton height="20px" width="120px" />
              </HStack>
              <Skeleton height="40px" width="full" />
              <HStack gap={2} width="full">
                <Skeleton height="24px" width="100px" />
                <Skeleton height="24px" width="100px" />
                <Skeleton height="24px" width="100px" />
              </HStack>
              <HStack width="full" justify="flex-end">
                <Skeleton height="32px" width="80px" />
                <Skeleton height="32px" width="80px" />
              </HStack>
            </VStack>
          ) : (
            /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
            <form onSubmit={handleSubmit(onSubmit)}>
              <VStack align="start" gap={3}>
                <HStack width="full">
                  <Avatar.Root size="sm">
                    <Avatar.Fallback name={session.data?.user.name ?? ""} />
                  </Avatar.Root>
                  <Text>{session.data?.user.name}</Text>
                  <Spacer />

                  {action === "edit" && (
                    <Menu.Root
                      open={open}
                      onOpenChange={(e) =>
                        setOpen(doNotCloseMenu ? true : e.open)
                      }
                    >
                      <Menu.Trigger asChild>
                        <Button size="xs" variant="ghost">
                          <MoreVertical size={16} />
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content portalled={false}>
                        <Menu.Item
                          value="delete"
                          color="red.600"
                          onClick={() => {
                            doNotCloseMenu = true;
                            handleDelete();
                          }}
                        >
                          {deleteAnnotation.isLoading ||
                          getAnnotation.isLoading ? (
                            <Spinner size="sm" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                          Delete
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  )}
                </HStack>
                <Input
                  {...register("comment")}
                  autoFocus={action === "new"}
                  placeholder={
                    action === "new" ? "Leave your comment here" : ""
                  }
                />

                <HStack gap={2} width="full" wrap="wrap">
                  {getAnnotationScoring.data?.map((scoreType) => (
                    <ScoreBlock
                      key={scoreType.id}
                      scoreType={{
                        ...scoreType,
                        options: scoreType.options as AnnotationScoreOption[],
                        dataType: scoreType.dataType!,
                        defaultValue: scoreType.defaultValue as {
                          value: string;
                          options: string[];
                        } | null,
                      }}
                      watch={watch}
                      setValue={setValue}
                      onReasonClick={() => handleReasonClick(scoreType.id)}
                    />
                  ))}
                </HStack>

                <HStack width="full">
                  <Spacer />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      reset();
                      commentState.resetComment();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    colorPalette="blue"
                    type="submit"
                    minWidth="fit-content"
                    size="sm"
                    loading={
                      createAnnotation.isLoading ||
                      updateAnnotation.isLoading ||
                      getAnnotation.isLoading
                    }
                  >
                    {action === "new" ? "Save" : "Update"}
                  </Button>
                </HStack>

                {getAnnotationScoring.data?.length === 0 && (
                  <>
                    <Separator />
                    <Text>
                      Scoring metrics are currently disabled. Enable them to add
                      more data to your annotations.
                    </Text>
                    <Link href={"/settings/annotation-scores"}>
                      <Button
                        colorPalette="blue"
                        minWidth="fit-content"
                        size="sm"
                      >
                        Enable scoring metrics
                      </Button>
                    </Link>
                  </>
                )}
              </VStack>
            </form>
          )}
        </Card.Body>
      </Card.Root>

      <ScoreReasonModal
        reason={selectedReason}
        open={scoreReasonModal.open}
        onClose={() => {
          scoreReasonModal.onClose();
          setSelectedScoreTypeId(null);
        }}
        onConfirm={(newReason) => {
          if (selectedScoreTypeId) {
            setValue(`scoreOptions.${selectedScoreTypeId}.reason`, newReason);
          }
          scoreReasonModal.onClose();
          setSelectedScoreTypeId(null);
        }}
      />
    </Box>
  );
}

type AnnotationScoreOption = {
  label: string;
  value: number;
};

type AnnotationScore = {
  id: string;
  name: string;
  options: AnnotationScoreOption[];
  description: string | null;
  dataType: AnnotationScoreDataType;
  defaultValue: { value: string; options: string[] } | null;
};

const ScoreBlock = ({
  scoreType,
  watch,
  setValue,
  onReasonClick,
}: {
  scoreType: AnnotationScore;
  watch: UseFormWatch<Annotation>;
  setValue: UseFormSetValue<Annotation>;
  onReasonClick: (scoreTypeId: string) => void;
}) => {
  const scoreValue = watch(`scoreOptions.${scoreType.id}.value`);
  const defaultRadioValue = scoreType.defaultValue?.value ?? "";

  const [tempValue, setTempValue] = useState<string | string[]>();

  useEffect(() => {
    const currentValue = scoreValue;
    if (currentValue) {
      setTempValue(currentValue);
    }
  }, [scoreValue]);

  const [open, setOpen] = useState(false);

  return (
    <>
      <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Popover.Trigger asChild>
          <Button size="xs" variant="outline">
            {scoreValue
              ? Array.isArray(scoreValue)
                ? scoreValue.join(", ")
                : scoreValue.toString()
              : scoreType.name}
            <ChevronDown size={16} />
          </Button>
        </Popover.Trigger>
        <Popover.Content>
          <Popover.Arrow />
          <Popover.CloseTrigger />
          <Popover.Header>{scoreType.description}</Popover.Header>
          <Popover.Body>
            {scoreType?.dataType === "CHECKBOX" ? (
              <Fieldset.Root>
                <CheckboxGroup
                  value={[...(tempValue ? [tempValue].flat() : [])]}
                  onValueChange={(value) => {
                    setTempValue(value);
                  }}
                >
                  <VStack align="start" gap={2}>
                    {scoreType.options.map((option, index) => (
                      <Checkbox value={option.value.toString()} key={index}>
                        {option.label}
                      </Checkbox>
                    ))}
                    <ReasonButtons
                      scoreTypeId={scoreType.id}
                      onReasonClick={onReasonClick}
                      setValue={setValue}
                      watch={watch}
                      tempValue={tempValue ?? ""}
                      setTempValue={setTempValue}
                      setOpen={setOpen}
                    />
                  </VStack>
                </CheckboxGroup>
              </Fieldset.Root>
            ) : (
              <Fieldset.Root>
                <RadioGroup
                  value={tempValue?.toString() ?? ""}
                  defaultValue={defaultRadioValue}
                  onValueChange={(change) => {
                    setTempValue(change.value ?? "");
                  }}
                >
                  <VStack align="start" gap={2}>
                    {scoreType.options.map((option) => (
                      <Radio value={option.value.toString()} key={option.value}>
                        {option.label}
                      </Radio>
                    ))}
                    <ReasonButtons
                      scoreTypeId={scoreType.id}
                      onReasonClick={onReasonClick}
                      setValue={setValue}
                      watch={watch}
                      tempValue={tempValue ?? ""}
                      setTempValue={setTempValue}
                      setOpen={setOpen}
                    />
                  </VStack>
                </RadioGroup>
              </Fieldset.Root>
            )}
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </>
  );
};

const ReasonButtons = ({
  scoreTypeId,
  onReasonClick,
  setValue,
  watch,
  tempValue,
  setTempValue,
  setOpen,
}: {
  scoreTypeId: string;
  onReasonClick: (scoreTypeId: string) => void;
  setValue: UseFormSetValue<Annotation>;
  watch: UseFormWatch<Annotation>;
  tempValue: string | string[];
  setTempValue: (value: string | string[]) => void;
  setOpen: (open: boolean) => void;
}) => (
  <>
    <Text fontSize="sm">
      {watch(`scoreOptions.${scoreTypeId}.reason`) &&
        `Reason: ${watch(`scoreOptions.${scoreTypeId}.reason`)}`}
    </Text>
    <HStack width="full">
      <Spacer />
      <Button
        size="xs"
        onClick={() => {
          setValue(`scoreOptions.${scoreTypeId}.value`, "");
          setValue(`scoreOptions.${scoreTypeId}.reason`, "");
          setTempValue("");
        }}
        variant="outline"
      >
        Clear
      </Button>
      <Button
        size="xs"
        onClick={() => {
          onReasonClick(scoreTypeId);
          setValue(`scoreOptions.${scoreTypeId}.value`, tempValue);
          setOpen(false);
        }}
        colorPalette="blue"
        disabled={!tempValue}
      >
        Apply
      </Button>
    </HStack>
  </>
);
