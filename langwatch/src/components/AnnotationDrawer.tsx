import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { unstable_batchedUpdates } from "react-dom";

import { ExternalLink, ThumbsDown, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { MetadataTag } from "~/components/MetadataTag";
import { SmallLabel } from "~/components/SmallLabel";

import { DeleteIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { HorizontalFormControl } from "./HorizontalFormControl";

export function AnnotationDrawer({
  traceId,
  action,
  annotationId,
}: {
  traceId: string;
  action: "new" | "edit";
  annotationId?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { onClose } = useDisclosure();
  const { closeDrawer, openDrawer } = useDrawer();

  const router = useRouter();

  const listTableView = router.query.view;

  const toast = useToast();

  const createAnnotation = api.annotation.create.useMutation();
  const deleteAnnotation = api.annotation.deleteById.useMutation();

  const getAnnotationScoring = api.annotationScore.getAllActive.useQuery({
    projectId: project?.id ?? "",
  });

  const getAnnotation = api.annotation.getById.useQuery({
    projectId: project?.id ?? "",
    annotationId: annotationId ?? "",
  });

  const updateAnnotation = api.annotation.updateByTraceId.useMutation();

  const { isThumbsUp, comment, id, scoreOptions } = getAnnotation.data ?? {
    isThumbsUp: "thumbsUp",
    comment: "",
    scoreOptions: {},
  };
  const scoreFields = Object.fromEntries(
    getAnnotationScoring.data?.map((score) => [score.id, ""]) ?? []
  );

  console.log(scoreFields);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
    reset,
  } = useForm({
    defaultValues: {
      isThumbsUp: "thumbsUp",
      comment: comment,
      scoreOptions: getAnnotation.data?.scoreOptions,
    },
  });

  const thumbsUpValue = watch("isThumbsUp");

  useEffect(() => {
    if (getAnnotation.data) {
      const { scoreOptions } = getAnnotation.data;
      const thumbValue = isThumbsUp === true ? "thumbsUp" : "thumbsDown";
      setValue("isThumbsUp", thumbValue);
      setValue("comment", comment);

      Object.entries(scoreOptions ?? {}).forEach(([key, value]) => {
        console.log(value);
        setValue(`scoreOptions.${key}`, {
          value: value.value,
          reason: value.reason,
        });
      });
    }
  }, [getAnnotation.data, isThumbsUp, comment, setValue]);

  type Annotation = {
    isThumbsUp: string;
    comment: string;
    scoreOptions: Record<string, string>;
  };

  const onSubmit = (data: Annotation) => {
    const isThumbsUp = data.isThumbsUp === "thumbsUp";

    if (action === "edit") {
      updateAnnotation.mutate(
        {
          id: id ?? "",
          projectId: project?.id ?? "",
          isThumbsUp: isThumbsUp,
          comment: data.comment,
          traceId: traceId,
          scoreOptions: data.scoreOptions,
        },
        {
          onSuccess: () => {
            toast({
              title: "Annotation Updated",
              description: `You have successfully updated the annotation`,
              status: "success",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });

            closeDrawer();
            reset();
            if (listTableView === "list" || listTableView === "table") {
              openDrawer("traceDetails", {
                traceId: traceId,
                annotationTab: true,
              });
            }
          },
          onError: () => {
            toast({
              title: "Error",
              description: "Error updating annotation",
              status: "error",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });
          },
        }
      );
    } else {
      createAnnotation.mutate(
        {
          projectId: project?.id ?? "",
          isThumbsUp: isThumbsUp,
          comment: data.comment,
          traceId: traceId,
          scoreOptions: data.scoreOptions,
        },
        {
          onSuccess: () => {
            toast({
              title: "Annotation Created",
              description: `You have successfully created an annotation`,
              status: "success",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });

            closeDrawer();
            reset();
            if (listTableView === "list" || listTableView === "table") {
              openDrawer("traceDetails", {
                traceId: traceId,
                annotationTab: true,
              });
            }
          },
          onError: () => {
            toast({
              title: "Error",
              description: "Error creating trigger",
              status: "error",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });
          },
        }
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
          toast({
            title: "Annotation Deleted",
            description: `You have successfully deleted the annotation`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
          closeDrawer();
        },
      }
    );
  };

  useEffect(() => {
    if (action === "edit") {
      const safeScoreOptions = scoreOptions ?? {};
      if (Object.keys(safeScoreOptions).length > 0) {
        Object.entries(safeScoreOptions).forEach(([key, value]) => {
          setValue(`scoreOptions.${key}.value`, value);
        });
      }
    }
  }, [scoreOptions, setValue, action]);

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"lg"}
      onClose={closeDrawer}
      onOverlayClick={onClose}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Annotate
            </Text>
          </HStack>
          <Text fontSize="sm" fontWeight="normal" marginTop={2}>
            <HStack align="center">
              <MetadataTag label="Trace ID" value={traceId} />{" "}
              <ExternalLink
                width={16}
                cursor="pointer"
                onClick={() =>
                  openDrawer("traceDetails", { traceId, annotationTab: true })
                }
              />
            </HStack>
          </Text>
        </DrawerHeader>

        <DrawerBody>
          {getAnnotation.isLoading ? (
            <Spinner />
          ) : (
            /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
            <form onSubmit={handleSubmit(onSubmit)}>
              <VStack align="start" spacing={3}>
                <RadioGroup value={thumbsUpValue}>
                  <HStack spacing={4}>
                    <VStack align="start">
                      <Radio
                        size="md"
                        value="thumbsUp"
                        colorScheme="blue"
                        alignItems="start"
                        spacing={3}
                        paddingTop={2}
                        {...register("isThumbsUp")}
                      >
                        <VStack align="start" marginTop={-1}>
                          <ThumbsUp />
                        </VStack>
                      </Radio>
                    </VStack>
                    <VStack align="start">
                      <Radio
                        size="md"
                        value="thumbsDown"
                        colorScheme="blue"
                        alignItems="start"
                        spacing={3}
                        paddingTop={2}
                        {...register("isThumbsUp")}
                      >
                        <VStack align="start" marginTop={-1}>
                          <ThumbsDown />
                        </VStack>
                      </Radio>
                    </VStack>
                  </HStack>
                </RadioGroup>
                {getAnnotationScoring.data?.map((scoreType) => {
                  return ScoreBlock(scoreType, watch, register);
                })}
                <VStack align="start" spacing={4} width="full">
                  <Text>Comments</Text>
                  <Textarea {...register("comment")} />
                </VStack>
                <HStack>
                  <Button
                    colorScheme="blue"
                    type="submit"
                    minWidth="fit-content"
                    isLoading={
                      createAnnotation.isLoading || updateAnnotation.isLoading
                    }
                  >
                    {action === "new" ? "Save" : "Update"}
                  </Button>
                  {action === "edit" && (
                    <Button
                      colorScheme="black"
                      variant="outline"
                      isLoading={deleteAnnotation.isLoading}
                      onClick={() => handleDelete()}
                    >
                      <DeleteIcon />
                    </Button>
                  )}
                </HStack>
              </VStack>
            </form>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
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
  description: string;
};

const ScoreBlock = (scoreType: AnnotationScore, watch: any, register: any) => {
  const scoreValue = watch(`scoreOptions.${scoreType.id}.value`);
  const scoreReason = watch(`scoreOptions.${scoreType.id}.reason`);

  return (
    <HorizontalFormControl
      label={scoreType.name}
      helper={scoreType.description}
      //isInvalid={!!errors.description}
    >
      <RadioGroup key={scoreType.id} value={scoreValue} padding={0}>
        <VStack align="start" spacing={2}>
          {scoreType.options.map((option) => {
            return (
              <Radio
                value={option.value.toString()}
                {...register(`scoreOptions.${scoreType.id}.value`)}
                key={option.value}
              >
                {option.label}
              </Radio>
            );
          })}
          <Spacer />
          <SmallLabel>Reasoning</SmallLabel>
          <Input {...register(`scoreOptions.${scoreType.id}.reason`)} />
        </VStack>
      </RadioGroup>
    </HorizontalFormControl>
  );
};
