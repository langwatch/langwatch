import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Popover,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Stack,
  Text,
  VStack,
  useDisclosure,
  useToast,
  Textarea,
} from "@chakra-ui/react";
import { TriggerAction, type Trigger } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";
import { ThumbsUp, ThumbsDown } from "react-feather";

import { HorizontalFormControl } from "./HorizontalFormControl";

import { useFilterParams } from "~/hooks/useFilterParams";

import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "next/router";
import { useEffect } from "react";

export function AnnotationDrawer() {
  const { project, organization, team } = useOrganizationTeamProject();
  const { onOpen, onClose, isOpen } = useDisclosure();
  const { closeDrawer } = useDrawer();
  const router = useRouter();

  const traceId = router.query.trace as string;

  const toast = useToast();

  const createAnnotation = api.annotation.create.useMutation();
  const getAnnotation = api.annotation.getByTraceId.useQuery({
    projectId: project?.id ?? "",
    traceId: traceId,
  });

  const updateAnnotation = api.annotation.updateByTraceId.useMutation();

  const { isThumbsUp, comment, id } = getAnnotation.data ?? {
    isThumbsUp: "thumbsUp",
    comment: "",
  };

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
    },
  });

  const thumbsUpValue = watch("isThumbsUp");

  useEffect(() => {
    if (getAnnotation.data) {
      console.log("test", isThumbsUp);

      const thumbValue = isThumbsUp === true ? "thumbsUp" : "thumbsDown";
      console.log("thumbValue", thumbValue);
      setValue("isThumbsUp", thumbValue);
      setValue("comment", comment);
    }
  }, [getAnnotation.data, setValue, isThumbsUp, comment]);

  type Annotation = {
    isThumbsUp: string;
    comment: string;
  };

  const onSubmit = (data: Annotation) => {
    console.log("data", data);

    const isThumbsUp = data.isThumbsUp === "thumbsUp";

    if (id) {
      updateAnnotation.mutate(
        {
          id,
          projectId: project?.id ?? "",
          isThumbsUp: isThumbsUp,
          comment: data.comment,
          traceId: traceId,
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
            reset();
            closeDrawer();
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
            reset();
            closeDrawer();
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
        </DrawerHeader>
        <DrawerBody>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack align="start" spacing={6}>
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
              <VStack align="start" spacing={4} width="full">
                <Text>Comments</Text>
                <Textarea {...register("comment")} />
              </VStack>
              <Button
                colorScheme="blue"
                type="submit"
                minWidth="fit-content"
                isLoading={
                  createAnnotation.isLoading || updateAnnotation.isLoading
                }
              >
                {id ? "Update" : "Save"}
              </Button>
            </VStack>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
