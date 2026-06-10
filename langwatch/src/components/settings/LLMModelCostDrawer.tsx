import { Button, Field, Heading, HStack, Input, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useDebounce } from "use-debounce";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "../../components/ui/drawer";
import { InputGroup } from "../../components/ui/input-group";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { MaybeStoredLLMModelCost } from "../../server/modelProviders/llmModelCost";
import { api } from "../../utils/api";
import { exactModelMatchRegex } from "../../utils/modelCostRegex";
import { isSafeRegex } from "../../utils/safeRegex";
import { isHandledByGlobalHandler } from "../../utils/trpcError";
import { HorizontalFormControl } from "../HorizontalFormControl";
import {
  LLMModelCostMatchingSpans,
  type MatchingSpansPreviewInput,
} from "./LLMModelCostMatchingSpans";
import { ScopeChipPicker, type ScopeTriadEntry } from "./ScopeChipPicker";

export function LLMModelCostDrawer({
  id,
  cloneModel,
  prefillModel,
  prefillRegex,
}: {
  id?: string;
  cloneModel?: string;
  /**
   * Pre-populate the form for the "add cost mapping" deep link from the
   * trace drawer (arrives via `drawer.prefillModel` / `drawer.prefillRegex`
   * URL params). Ignored when editing an existing row.
   */
  prefillModel?: string;
  prefillRegex?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();

  const llmModelCosts = api.llmModelCost.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size={"xl"}
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading>{id ? "Edit LLM Model Cost" : "Add LLM Model Cost"}</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {llmModelCosts.data && (
            <LLMModelCostForm
              id={id}
              cloneModel={cloneModel}
              prefillModel={prefillModel}
              prefillRegex={prefillRegex}
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
  prefillModel,
  prefillRegex,
  llmModelCosts,
}: {
  id?: string;
  cloneModel?: string;
  prefillModel?: string;
  prefillRegex?: string;
  llmModelCosts: MaybeStoredLLMModelCost[];
}) {
  const { organization, team, project } = useOrganizationTeamProject();

  const { closeDrawer } = useDrawer();
  const createOrUpdate = api.llmModelCost.createOrUpdate.useMutation();

  const llmModelCostsQuery = api.llmModelCost.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const currentLLMModelCost = id
    ? llmModelCosts.find((llmModelCost) => llmModelCost.id === id)
    : cloneModel
      ? llmModelCosts.find(
          (llmModelCost) =>
            !llmModelCost.id && llmModelCost.model === cloneModel,
        )
      : undefined;

  type LLMModelCostForm = {
    model: string;
    inputCostPerToken: number;
    outputCostPerToken: number;
    cacheReadCostPerToken?: number;
    cacheCreationCostPerToken?: number;
    regex: string;
  };

  // Single-organization scope this cost applies to (ADR-021). Editing keeps
  // the row's scope; new/cloned rows default to the current project. The
  // org/team rows let an admin push one cost policy down the cascade
  // (PROJECT -> TEAM -> ORGANIZATION) instead of every project re-entering it.
  const [scope, setScope] = useState<ScopeTriadEntry[]>(() => {
    if (currentLLMModelCost?.scopeType && currentLLMModelCost?.scopeId) {
      return [
        {
          scopeType: currentLLMModelCost.scopeType,
          scopeId: currentLLMModelCost.scopeId,
        },
      ];
    }
    return project?.id ? [{ scopeType: "PROJECT", scopeId: project.id }] : [];
  });

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<LLMModelCostForm>({
    defaultValues: {
      model: currentLLMModelCost?.model ?? prefillModel,
      inputCostPerToken: currentLLMModelCost?.inputCostPerToken,
      outputCostPerToken: currentLLMModelCost?.outputCostPerToken,
      cacheReadCostPerToken: currentLLMModelCost?.cacheReadCostPerToken,
      cacheCreationCostPerToken: currentLLMModelCost?.cacheCreationCostPerToken,
      regex: currentLLMModelCost?.regex ?? prefillRegex,
    },
  });

  // Live values feeding the matching-spans preview. Debounced so the
  // ClickHouse-backed preview doesn't fire on every keystroke; rates pass
  // through a finite-number gate because react-hook-form yields NaN /
  // empty-string while a numeric field is being edited.
  const liveValues = useWatch({ control });
  const [debouncedValues] = useDebounce(liveValues, 400);
  const finiteOrUndefined = (value: unknown): number | undefined => {
    const num = typeof value === "string" ? Number(value) : (value as number);
    return typeof num === "number" && Number.isFinite(num) && num >= 0
      ? num
      : undefined;
  };
  const previewInput: MatchingSpansPreviewInput = {
    regex: debouncedValues.regex ?? "",
    model: debouncedValues.model || undefined,
    inputCostPerToken: finiteOrUndefined(debouncedValues.inputCostPerToken),
    outputCostPerToken: finiteOrUndefined(debouncedValues.outputCostPerToken),
    cacheReadCostPerToken: finiteOrUndefined(
      debouncedValues.cacheReadCostPerToken,
    ),
    cacheCreationCostPerToken: finiteOrUndefined(
      debouncedValues.cacheCreationCostPerToken,
    ),
  };

  const onSubmit = (data: LLMModelCostForm) => {
    if (!project?.id) return;

    const optionalRate = (value: number | undefined) =>
      value == null || isNaN(value) ? undefined : value;

    const selectedScope = scope[0];

    createOrUpdate.mutate(
      {
        id,
        model: data.model,
        regex: data.regex,
        inputCostPerToken: data.inputCostPerToken,
        outputCostPerToken: data.outputCostPerToken,
        cacheReadCostPerToken: optionalRate(data.cacheReadCostPerToken),
        cacheCreationCostPerToken: optionalRate(data.cacheCreationCostPerToken),
        projectId: project.id,
        scopeType: selectedScope?.scopeType,
        scopeId: selectedScope?.scopeId,
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
          });
          closeDrawer();
          void llmModelCostsQuery.refetch();
        },
        onError: (error) => {
          if (isHandledByGlobalHandler(error)) return;
          toaster.create({
            title: "Error",
            description: error.message || "Error creating LLM model cost",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <HorizontalFormControl
          label="Applies to"
          helper="Pick the scope this cost rule applies to. Project-level rules override team-level, which override organization-level."
        >
          <ScopeChipPicker
            label=""
            singleSelect
            value={scope}
            onChange={setScope}
            organizationId={organization?.id}
            organizationName={organization?.name}
            teamId={team?.id}
            teamName={team?.name}
            projectId={project?.id}
            projectName={project?.name}
            currentOrganizationId={organization?.id}
            currentTeamId={team?.id}
            currentProjectId={project?.id}
          />
        </HorizontalFormControl>
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
                  isSafeRegex(value) ||
                  "Please enter a valid regular expression",
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.regex?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <LLMModelCostMatchingSpans
          input={previewInput}
          onPickModel={(model) => {
            setValue("regex", exactModelMatchRegex(model), {
              shouldValidate: true,
              shouldDirty: true,
            });
            if (!getValues("model")) {
              setValue("model", model, { shouldDirty: true });
            }
          }}
        />
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
        <HorizontalFormControl
          label="Cache Read Cost Per Token"
          helper="Optional. Cost per cached input token read, in USD. Leave blank to bill cache reads at the input rate"
          invalid={!!errors.cacheReadCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
            <Input
              placeholder="0.00"
              {...register("cacheReadCostPerToken", {
                setValueAs: (value) =>
                  value === "" || value == null ? undefined : Number(value),
              })}
            />
          </InputGroup>
          <Field.ErrorText>
            {errors.cacheReadCostPerToken?.message}
          </Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Cache Write Cost Per Token"
          helper="Optional. Cost per cached input token written, in USD. Leave blank to bill cache writes at the input rate"
          invalid={!!errors.cacheCreationCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
            <Input
              placeholder="0.00"
              {...register("cacheCreationCostPerToken", {
                setValueAs: (value) =>
                  value === "" || value == null ? undefined : Number(value),
              })}
            />
          </InputGroup>
          <Field.ErrorText>
            {errors.cacheCreationCostPerToken?.message}
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
