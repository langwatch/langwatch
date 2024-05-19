import {
  Box,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  Flex,
  FormControl,
  FormErrorMessage,
  HStack,
  Link,
  Select,
  Spacer,
  Stack,
  Text,
  Textarea,
  Tooltip,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { DatabaseSchema } from "@prisma/client";
import { useEffect, useState } from "react";
import { HelpCircle } from "react-feather";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  chatMessageSchema,
  datasetSpanSchema,
} from "~/server/tracer/types.generated";
import { api } from "~/utils/api";
import { displayName } from "~/utils/datasets";
import { AddDatasetDrawer } from "./AddDatasetDrawer";
import { useForm, type SubmitHandler } from "react-hook-form";

type FormValues = {
  datasetId: string;
};

interface AddDatasetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  traceId?: string;
  selectedTraceIds?: string[];
}

export function AddDatasetRecordDrawerV2(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = api.datasetRecord.create.useMutation();
  const toast = useToast();
  const { onOpen, onClose, isOpen } = useDisclosure();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>();

  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery({
    projectId: project?.id ?? "",
    traceIds: props?.selectedTraceIds ?? [props?.traceId ?? ""],
  });

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const onCreateDatasetSuccess = () => {
    onClose();
    void datasets.refetch();
  };

  const handleOnClose = () => {
    props.onClose();
    reset();
  };

  const onSubmit: SubmitHandler<FormValues> = (data) => {
    console.log(data);
    // handle form submission
  };

  return (
    <Drawer
      isOpen={props.isOpen}
      placement="right"
      size={"xl"}
      onClose={handleOnClose}
      blockScrollOnMount={false}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="3xl">
              Add to Dataset
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody overflow="scroll">
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Dataset"
              helper="Add to an existing dataset or create a new one"
              isInvalid={!!errors.datasetId}
            >
              {/* TODO: keep last selection on localstorage */}
              <Select
                {...register("datasetId", { required: "Dataset is required" })}
              >
                <option value={""}>Select Dataset</option>
                {datasets.data
                  ? datasets.data?.map((dataset, index) => (
                      <option key={index} value={dataset.id}>
                        {dataset.name}
                      </option>
                    ))
                  : null}
              </Select>
              {errors.datasetId && (
                <FormErrorMessage>{errors.datasetId.message}</FormErrorMessage>
              )}
              <Button
                colorScheme="blue"
                onClick={() => {
                  onOpen();
                }}
                minWidth="fit-content"
                variant="link"
                marginTop={2}
                fontWeight={"normal"}
              >
                + Create New
              </Button>
            </HorizontalFormControl>
            <Button type="submit" colorScheme="blue" mt={4}>
              Submit
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
      <AddDatasetDrawer
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer>
  );
}
