/**
 * `llmModelCost`, as the address spells it: the form behind every cost rule.
 *
 * RECOVERED FROM `platform/app/src/components/settings/LLMModelCostDrawer.tsx`,
 * deleted in `cc91631cd8`. Two live surfaces kept writing the address after it
 * went — the Model Costs settings table's Add / Edit / Clone, and the trace
 * drawer's "this model has no cost mapping" suggestion, which deep-links here
 * with the model and an exact-match regex prefilled — so the one place a cost
 * rule can be authored opened nothing.
 *
 * WHAT CHANGED IN THE LIFT, all of it because the platform owned it:
 *
 * - The project, team and organization come from the host port rather than
 *   from `useOrganizationTeamProject`, and their NAMES come from the same
 *   `availableScopes()` the providers table resolves its chips with.
 * - The toast is the host's `failed`, asked after `isReportedGlobally` exactly
 *   as the costs table next door asks it.
 * - Closing goes through `@langwatch/ui-drawer`'s navigator rather than the
 *   application's own hook. That package IS the framework — it owns the address
 *   vocabulary and the navigation stack and names no drawer — so a feature may
 *   depend on it; what a feature may not carry is the REGISTRY, which is
 *   composition.
 * - `applyHandledErrorToForm` and `FormServerError` come from
 *   `@langwatch/workflow-web/studio-host/errors`, the same import
 *   `@langwatch/evaluator-web` takes for the same two names. They are pure —
 *   they decide WHERE a refusal lands, never what it says — so they carry no
 *   host of their own.
 *
 * THE SCOPE IS A SINGLE ORGANIZATION'S (ADR-021). Editing keeps the row's own
 * scope; a new or cloned row defaults to the current project. The organization
 * and team rows are what let an admin push one cost policy down the cascade
 * (PROJECT overrides TEAM overrides ORGANIZATION) instead of every project
 * re-entering it.
 */

import { Button, Field, Heading, Input, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useDebounce } from "use-debounce";

import { Drawer } from "@langwatch/design-system/drawer";
import { useDrawer } from "@langwatch/ui-drawer";
import { InputGroup } from "@langwatch/design-system/input-group";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { HorizontalFormControl } from "@langwatch/workflow-web/components/HorizontalFormControl";
import {
  applyHandledErrorToForm,
  FormServerError,
} from "@langwatch/workflow-web/studio-host/errors";

import { modelProviderApi } from "../../behavior/model-provider-api";
import { useModelProviderHost } from "../../model/model-provider-host";
import { toLLMModelCostRow, type LLMModelCostRow } from "../../model/llm-model-cost-row";
import { exactModelMatchRegex, isSafeRegex } from "../../model/safe-regex";
import {
  LLMModelCostMatchingSpans,
  type MatchingSpansPreviewInput,
} from "./llm-model-cost-matching-spans";

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

  const currentLLMModelCost = id
    ? llmModelCosts.find((llmModelCost) => llmModelCost.id === id)
    : cloneModel
      ? llmModelCosts.find((llmModelCost) => !llmModelCost.id && llmModelCost.model === cloneModel)
      : undefined;

  type LLMModelCostForm = {
    model: string;
    inputCostPerToken: number;
    outputCostPerToken: number;
    cacheReadCostPerToken?: number;
    cacheCreationCostPerToken?: number;
    cacheCreation1hCostPerToken?: number;
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
    return projectId ? [{ scopeType: "PROJECT", scopeId: projectId }] : [];
  });

  const form = useForm<LLMModelCostForm>({
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
  // ClickHouse-backed preview doesn't fire on every keystroke; rates pass
  // through a finite-number gate because react-hook-form yields NaN /
  // empty-string while a numeric field is being edited.
  const liveValues = useWatch({ control });
  const [debouncedValues] = useDebounce(liveValues, 400);
  const finiteOrUndefined = (value: unknown): number | undefined => {
    const num = typeof value === "string" ? Number(value) : (value as number);
    return typeof num === "number" && Number.isFinite(num) && num >= 0 ? num : undefined;
  };
  const previewInput: MatchingSpansPreviewInput = {
    regex: debouncedValues.regex ?? "",
    model: debouncedValues.model || undefined,
    inputCostPerToken: finiteOrUndefined(debouncedValues.inputCostPerToken),
    outputCostPerToken: finiteOrUndefined(debouncedValues.outputCostPerToken),
    cacheReadCostPerToken: finiteOrUndefined(debouncedValues.cacheReadCostPerToken),
    cacheCreationCostPerToken: finiteOrUndefined(debouncedValues.cacheCreationCostPerToken),
    cacheCreation1hCostPerToken: finiteOrUndefined(debouncedValues.cacheCreation1hCostPerToken),
  };

  const onSubmit = (data: LLMModelCostForm) => {
    if (!projectId) return;

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
        cacheCreation1hCostPerToken: optionalRate(data.cacheCreation1hCostPerToken),
        projectId,
        scopeType: selectedScope?.scopeType,
        scopeId: selectedScope?.scopeId,
      },
      {
        onSuccess: () => {
          host.succeeded({
            title: "Success",
            description: `LLM model cost ${id ? "updated" : "created"} successfully`,
          });
          closeDrawer();
          void llmModelCostsQuery.refetch();
        },
        onError: (error) => {
          // The refusal goes on the field the server named where it named one,
          // and only falls back to a notice when it named none. Reporting the
          // same rejection twice reads as two failures.
          if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
          if (host.isReportedGlobally(error)) return;
          host.failed({
            error,
            fallbackTitle: id ? "Couldn't update model cost" : "Couldn't create model cost",
          });
        },
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
                setValueAs: (value) => (value === "" || value == null ? undefined : Number(value)),
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
                setValueAs: (value) => (value === "" || value == null ? undefined : Number(value)),
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
                setValueAs: (value) => (value === "" || value == null ? undefined : Number(value)),
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
