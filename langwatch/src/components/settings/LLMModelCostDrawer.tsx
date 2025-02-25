import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  Field,
  HStack,
  Input,
  InputGroup,
  InputLeftAddon,
  InputRightAddon,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useDrawer } from "../CurrentDrawer";
import { api } from "../../utils/api";
import { useForm } from "react-hook-form";
import { HorizontalFormControl } from "../HorizontalFormControl";
import type { MaybeStoredLLMModelCost } from "../../server/modelProviders/llmModelCost";

export function LLMModelCostDrawer({
  id,
  cloneModel,
}: {
  id?: string;
  cloneModel?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();

  const llmModelCosts = api.llmModelCost.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"xl"}
      onClose={closeDrawer}
      onOverlayClick={closeDrawer}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              {id ? "Edit LLM Model Cost" : "Add LLM Model Cost"}
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          {llmModelCosts.data && (
            <LLMModelCostForm
              id={id}
              cloneModel={cloneModel}
              llmModelCosts={llmModelCosts.data}
            />
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function LLMModelCostForm({
  id,
  cloneModel,
  llmModelCosts,
}: {
  id?: string;
  cloneModel?: string;
  llmModelCosts: MaybeStoredLLMModelCost[];
}) {
  const { project } = useOrganizationTeamProject();

  const toast = useToast();
  const { closeDrawer } = useDrawer();
  const createOrUpdate = api.llmModelCost.createOrUpdate.useMutation();

  const llmModelCostsQuery = api.llmModelCost.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  const currentLLMModelCost = id
    ? llmModelCosts.find((llmModelCost) => llmModelCost.id === id)
    : cloneModel
    ? llmModelCosts.find(
        (llmModelCost) => !llmModelCost.id && llmModelCost.model === cloneModel
      )
    : undefined;

  type LLMModelCostForm = {
    model: string;
    inputCostPerToken: number;
    outputCostPerToken: number;
    regex: string;
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LLMModelCostForm>({
    defaultValues: {
      model: currentLLMModelCost?.model,
      inputCostPerToken: currentLLMModelCost?.inputCostPerToken,
      outputCostPerToken: currentLLMModelCost?.outputCostPerToken,
      regex: currentLLMModelCost?.regex,
    },
  });

  const onSubmit = (data: LLMModelCostForm) => {
    if (!project?.id) return;

    createOrUpdate.mutate(
      {
        id,
        model: data.model,
        regex: data.regex,
        inputCostPerToken: data.inputCostPerToken,
        outputCostPerToken: data.outputCostPerToken,
        projectId: project.id,
      },
      {
        onSuccess: () => {
          toast({
            title: "Success",
            description: `LLM model cost ${
              id ? "updated" : "created"
            } successfully`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          closeDrawer();
          void llmModelCostsQuery.refetch();
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Error creating LLM model cost",
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
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <HorizontalFormControl
          label="Model Name"
          helper="Identifier for your LLM model cost rule"
          invalid={!!errors.model}
        >
          <Input required {...register("model")} />
          <Field.ErrorText>{errors.model?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Regex"
          helper="Regular expression used to match the model name captured during tracing"
          invalid={!!errors.regex}
        >
          <InputGroup>
            <InputLeftAddon paddingX={2} fontFamily="monospace">
              /
            </InputLeftAddon>
            <Input
              required
              {...register("regex", {
                validate: (value) =>
                  isValidRegex(value) ||
                  "Please enter a valid regular expression",
              })}
            />
            <InputRightAddon paddingX={2} fontFamily="monospace">
              /
            </InputRightAddon>
          </InputGroup>
          <Field.ErrorText>{errors.regex?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Input Cost Per Token"
          helper="Cost per input token in USD"
          invalid={!!errors.inputCostPerToken}
        >
          <InputGroup>
            <InputLeftAddon>$</InputLeftAddon>
            <Input
              placeholder="0.00"
              required
              {...register("inputCostPerToken", {
                valueAsNumber: true,
                validate: (value) => !isNaN(value),
              })}
            />
          </InputGroup>
          <Field.ErrorText>
            {errors.inputCostPerToken?.message}
          </Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Output Cost Per Token"
          helper="Cost per output token in USD"
          invalid={!!errors.outputCostPerToken}
        >
          <InputGroup>
            <InputLeftAddon>$</InputLeftAddon>
            <Input
              placeholder="0.00"
              required
              {...register("outputCostPerToken", {
                valueAsNumber: true,
                validate: (value) => !isNaN(value),
              })}
            />
          </InputGroup>
          <Field.ErrorText>
            {errors.outputCostPerToken?.message}
          </Field.ErrorText>
        </HorizontalFormControl>
        <Button
          marginTop={4}
          colorPalette="orange"
          type="submit"
          minWidth="fit-content"
          isLoading={createOrUpdate.isLoading}
        >
          Save
        </Button>
      </form>
    </>
  );
}

const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
};
