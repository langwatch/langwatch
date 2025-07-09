import { Button, Field, HStack, Input, Text } from "@chakra-ui/react";

import { usimport { api } from "../../utils/api";
import { useForm } from "react-hook-form";
import { HorizontalFormControl } from "../HorizontalFormControl";
import type { MaybeStoredLLMModelCost } from "../../server/modelProviders/llmModelCost";
import { Drawer } from "../../components/ui/drawer";
import { InputGroup } from "../../components/ui/input-group";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useDrawer } from "../CurrentDrawer";
ction LLMModelCostDrawer({
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
    <Drawer.Root
      open={true}
      placement="end"
      size={"xl"}
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              {id ? "Edit LLM Model Cost" : "Add LLM Model Cost"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {llmModelCosts.data && (
            <LLMModelCostForm
              id={id}
              cloneModel={cloneModel}
              llmModelCosts={llmModelCosts.data}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
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
          toaster.create({
            title: "Success",
            description: `LLM model cost ${
              id ? "updated" : "created"
            } successfully`,
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          closeDrawer();
          void llmModelCostsQuery.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description: "Error creating LLM model cost",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
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
          <InputGroup
            startElement={
              <Text paddingX={2} fontFamily="monospace">
                /
              </Text>
            }
            endElement={
              <Text paddingX={2} fontFamily="monospace">
                /
              </Text>
            }
          >
            <Input
              required
              {...register("regex", {
                validate: (value) =>
                  isValidRegex(value) ||
                  "Please enter a valid regular expression",
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.regex?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Input Cost Per Token"
          helper="Cost per input token in USD"
          invalid={!!errors.inputCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
            <Input
              placeholder="0.00"
              required
              {...register("inputCostPerToken", {
                valueAsNumber: true,
                validate: (value) => !isNaN(value),
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.inputCostPerToken?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Output Cost Per Token"
          helper="Cost per output token in USD"
          invalid={!!errors.outputCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
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
          loading={createOrUpdate.isLoading}
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
