/**
 * `llmModelCost`: the form behind every cost rule, opened from the Model Costs table
 * (Add/Edit/Clone) and the trace drawer's cost-mapping
 * suggestion. Scope is a single organization's (ADR-021): editing keeps the
 */

import { Button, Field, Heading, Input, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { useDebounce } from "use-debounce";

import { Drawer } from "@langwatch/design-system/drawer";
import { useDrawer } from "@langwatch/ui-drawer";
import { InputGroup } from "@langwatch/design-system/input-group";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { applyHandledErrorToForm } from "@langwatch/ui-host/errors";
import { FormServerError } from "@langwatch/workflow-web/surfaces/handled-error-views";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { useModelProviderHost } from "../../model/model-provider-host.ts";
import { toLLMModelCostRow, type LLMModelCostRow } from "../../model/llm-model-cost-row.ts";
import { exactModelMatchRegex, isSafeRegex } from "../../model/safe-regex.ts";
import {
  LLMModelCostMatchingSpans,
  type MatchingSpansPreviewInput,
} from "./llm-model-cost-matching-spans.tsx";

interface LLMModelCostFormValues {
  model: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
  regex: string;
}

/** The row being edited, or the row a clone starts from; neither when adding. */
function findEditedCost({
  cloneModel,
  id,
  llmModelCosts,
}: {
  cloneModel?: string;
  id?: string;
  llmModelCosts: LLMModelCostRow[];
}): LLMModelCostRow | undefined {
  if (id) return llmModelCosts.find((llmModelCost) => llmModelCost.id === id);
  if (!cloneModel) return undefined;

  return llmModelCosts.find(
    (llmModelCost) => !llmModelCost.id && llmModelCost.model === cloneModel,
  );
}

/**
 * Editing keeps the row's scope; new and cloned rows default to the current
 * project. The org/team rows let an admin push one cost policy down the
 * cascade (PROJECT -> TEAM -> ORGANIZATION) instead of every project
 * re-entering it.
 */
function initialScope({
  editedCost,
  projectId,
}: {
  editedCost: LLMModelCostRow | undefined;
  projectId: string | undefined;
}): ScopeTriadEntry[] {
  if (editedCost?.scopeType && editedCost?.scopeId) {
    return [{ scopeType: editedCost.scopeType, scopeId: editedCost.scopeId }];
  }

  return projectId ? [{ scopeType: "PROJECT", scopeId: projectId }] : [];
}

/**
 * Rates pass through a finite-number gate because react-hook-form yields NaN
 * or an empty string while a numeric field is being edited.
 */
function finiteOrUndefined(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value) : (value as number);
  const usable = typeof num === "number" && Number.isFinite(num) && num >= 0;

  return usable ? num : undefined;
}

function optionalRate(value: number | undefined): number | undefined {
  return value == null || isNaN(value) ? undefined : value;
}

function optionalNumberValue(value: unknown): number | undefined {
  return value === "" || value == null ? undefined : Number(value);
}

/**
 * The refusal goes on the field the server named where it named one, and only
 * falls back to a notice when it named none. Reporting the same rejection
 * twice reads as two failures.
 */
function reportCostFailure({
  error,
  form,
  host,
  id,
}: {
  error: unknown;
  form: UseFormReturn<LLMModelCostFormValues>;
  host: ReturnType<typeof useModelProviderHost>;
  id?: string;
}): void {
  if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
  if (host.isReportedGlobally(error)) return;

  host.failed({
    error,
    fallbackTitle: id ? "Couldn't update model cost" : "Couldn't create model cost",
  });
}

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
  const { projectId } = useModelProviderHost().scope();
  const { closeDrawer } = useDrawer();

  const llmModelCosts = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  return (
    <Drawer.Root open={true} placement="end" size={"xl"} onOpenChange={() => closeDrawer()}>
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
              llmModelCosts={llmModelCosts.data.map(toLLMModelCostRow)}
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
  llmModelCosts: LLMModelCostRow[];
}) {
  const host = useModelProviderHost();
  const { closeDrawer } = useDrawer();
  const { organizationId, teamId, projectId } = host.scope();
  const available = host.availableScopes();
  const organizationName = available.organization?.name;
  const teamName = available.teams.find((candidate) => candidate.id === teamId)?.name;
  const project = available.projects.find((candidate) => candidate.id === projectId);

  const createOrUpdate = modelProviderApi.llmModelCost.createOrUpdate.useMutation();

  const llmModelCostsQuery = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const currentLLMModelCost = findEditedCost({ cloneModel, id, llmModelCosts });

  // Single-organization scope this cost applies to (ADR-021).
  const [scope, setScope] = useState<ScopeTriadEntry[]>(() =>
    initialScope({ editedCost: currentLLMModelCost, projectId }),
  );

  const form = useForm<LLMModelCostFormValues>({
    defaultValues: {
      model: currentLLMModelCost?.model ?? prefillModel,
      inputCostPerToken: currentLLMModelCost?.inputCostPerToken,
      outputCostPerToken: currentLLMModelCost?.outputCostPerToken,
      cacheReadCostPerToken: currentLLMModelCost?.cacheReadCostPerToken,
      cacheCreationCostPerToken: currentLLMModelCost?.cacheCreationCostPerToken,
      cacheCreation1hCostPerToken: currentLLMModelCost?.cacheCreation1hCostPerToken,
      regex: currentLLMModelCost?.regex ?? prefillRegex,
    },
  });
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = form;

  // Live values feeding the matching-spans preview. Debounced so the
  // ClickHouse-backed preview doesn't fire on every keystroke.
  const liveValues = useWatch({ control });
  const [debouncedValues] = useDebounce(liveValues, 400);
  const previewInput: MatchingSpansPreviewInput = {
    regex: debouncedValues.regex ?? "",
    model: debouncedValues.model || undefined,
    inputCostPerToken: finiteOrUndefined(debouncedValues.inputCostPerToken),
    outputCostPerToken: finiteOrUndefined(debouncedValues.outputCostPerToken),
    cacheReadCostPerToken: finiteOrUndefined(debouncedValues.cacheReadCostPerToken),
    cacheCreationCostPerToken: finiteOrUndefined(debouncedValues.cacheCreationCostPerToken),
    cacheCreation1hCostPerToken: finiteOrUndefined(debouncedValues.cacheCreation1hCostPerToken),
  };

  const savedVerb = id ? "updated" : "created";

  const onSubmit = (data: LLMModelCostFormValues) => {
    if (!projectId) return;

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
        cacheCreation1hCostPerToken: optionalRate(data.cacheCreation1hCostPerToken),
        projectId,
        scopeType: selectedScope?.scopeType,
        scopeId: selectedScope?.scopeId,
      },
      {
        onSuccess: () => {
          host.succeeded({
            title: "Success",
            description: `LLM model cost ${savedVerb} successfully`,
          });
          closeDrawer();
          void llmModelCostsQuery.refetch();
        },
        onError: (error) => reportCostFailure({ error, form, host, id }),
      },
    );
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FormServerError form={form} />
        <HorizontalFormControl
          label="Applies to"
          helper="Pick the scope this cost rule applies to. Project-level rules override team-level, which override organization-level."
        >
          <ScopeChipPicker
            label=""
            singleSelect
            value={scope}
            onChange={setScope}
            organizationId={organizationId}
            organizationName={organizationName}
            teamId={teamId}
            teamName={teamName}
            projectId={projectId}
            projectName={project?.name}
            currentOrganizationId={organizationId}
            currentTeamId={teamId}
            currentProjectId={projectId}
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
                  isSafeRegex(value) || "Please enter a valid regular expression",
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
          <Field.ErrorText>{errors.outputCostPerToken?.message}</Field.ErrorText>
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
                setValueAs: optionalNumberValue,
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.cacheReadCostPerToken?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Cache Write Cost Per Token (5 minutes)"
          helper="Optional. Cost per cached input token written, in USD. Leave blank to bill cache writes at the input rate"
          invalid={!!errors.cacheCreationCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
            <Input
              placeholder="0.00"
              {...register("cacheCreationCostPerToken", {
                setValueAs: optionalNumberValue,
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.cacheCreationCostPerToken?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <HorizontalFormControl
          label="Cache Write Cost Per Token (1 hour)"
          helper="Optional. Cost per cached input token written to an hour-long cache, in USD. Leave blank to bill those writes at the five-minute rate"
          invalid={!!errors.cacheCreation1hCostPerToken}
        >
          <InputGroup startElement={<Text>$</Text>}>
            <Input
              placeholder="0.00"
              {...register("cacheCreation1hCostPerToken", {
                setValueAs: optionalNumberValue,
              })}
            />
          </InputGroup>
          <Field.ErrorText>{errors.cacheCreation1hCostPerToken?.message}</Field.ErrorText>
        </HorizontalFormControl>
        <Button
          marginTop={4}
          colorPalette="orange"
          type="submit"
          minWidth="fit-content"
          loading={createOrUpdate.isPending}
        >
          Save
        </Button>
      </form>
    </>
  );
}
