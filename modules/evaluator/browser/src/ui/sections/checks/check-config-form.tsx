import { zodResolver } from "@hookform/resolvers/zod";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
  type MappingState,
  mappingStateSchema,
} from "@langwatch/dataset-contract";
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import {
  Accordion,
  Button,
  Card,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { slugify } from "@langwatch/design-system/slugify";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  evaluatorDisplayName,
  evaluatorsSchema,
  evaluatorSettingsSchemaFor,
  evaluatorTypesSchema,
  getEvaluatorDefaultSettings,
  type EvaluatorDefinition,
  findEvaluatorDefinitions,
} from "@langwatch/evaluator-contract";
import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { EvaluationExecutionMode } from "@langwatch/workflow-contract";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { ChevronDown, Edit2, HelpCircle } from "react-feather";
import {
  Controller,
  FormProvider,
  type Resolver,
  useFieldArray,
  useForm,
  type UseFormReturn,
} from "react-hook-form";
import { z } from "zod";

import { evaluatorApi } from "../../../behavior/evaluator-api.ts";
import { EvaluatorTracesMapping } from "../../../behavior/lent-peers.tsx";
import { useAvailableEvaluators } from "../../../behavior/use-available-evaluators.ts";
import { useEvaluatorDefaultModels } from "../../../behavior/use-evaluator-default-models.ts";
import {
  type CheckPreconditions,
  checkPreconditionsSchema,
} from "../../../model/evaluations/types.ts";
import { DEFAULT_EMBEDDINGS_MODEL } from "../../../model/workflow/platform-defaults.ts";
import { PreconditionsField } from "../../elements/checks/preconditions-field.tsx";
import DynamicZodForm from "./dynamic-zod-form.tsx";
import { EvaluationManualIntegration } from "./evaluation-manual-integration.tsx";
import { EvaluatorSelection } from "./evaluator-selection.tsx";
import { TryItOut } from "./try-it-out.tsx";

export interface CheckConfigFormData {
  name: string;
  checkType: string | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Record<string, unknown>;
  executionMode?: EvaluationExecutionMode;
  storeSettingsOnCode?: boolean;
  mappings: MappingState;
}

interface CheckConfigFormProps {
  checkId?: string;
  defaultValues?: Partial<CheckConfigFormData>;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  loading: boolean;
}

export default function CheckConfigForm({
  checkId,
  defaultValues,
  onSubmit,
  loading,
}: CheckConfigFormProps) {
  const { project } = useOrganizationTeamProject();
  const isNameAvailable = evaluatorApi.monitors.isNameAvailable.useMutation();
  const [isNameAlreadyInUse, setIsNameAlreadyInUse] = useState(false);
  // Cascade-resolved defaults so the form's initial model /
  // embeddings_model values reflect the project's configured
  // providers instead of the generic DEFAULT_MODEL fallback.
  const { resolvedDefaultModel, resolvedDefaultEmbeddings } = useEvaluatorDefaultModels({
    projectId: project?.id,
  });

  const validateNameUniqueness = async (name: string) => {
    const result = await isNameAvailable.mutateAsync({
      projectId: project?.id ?? "",
      name,
      checkId,
    });

    setIsNameAlreadyInUse(!result.available);

    return result.available;
  };

  const form = useForm<CheckConfigFormData>({
    defaultValues,
    resolver: checkConfigResolver(validateNameUniqueness),
  });

  const { handleSubmit, watch, control } = form;

  const checkType = watch("checkType");
  const preconditions = watch("preconditions");
  const nameValue = watch("name");
  const sample = watch("sample");
  const executionMode = watch("executionMode");
  const storeSettingsOnCode = watch("storeSettingsOnCode");
  const mappings = watch("mappings") ?? DEFAULT_MAPPINGS;
  const settings = watch("settings");

  useEffect(() => {
    if (!mappings || mappings.mapping) return;
    const legacy = legacyMappingsSchema.safeParse(mappings);
    if (legacy.success) form.setValue("mappings", migrateLegacyMappings(legacy.data));
  }, [form, mappings]);

  const {
    fields: fieldsPrecondition,
    append: appendPrecondition,
    remove: removePrecondition,
  } = useFieldArray({
    control,
    name: "preconditions",
  });
  const slug = slugify(nameValue || "", {
    lower: true,
    strict: true,
  });

  const router = useRouter();
  const isChoosing = router.pathname.endsWith("/choose");

  const availableEvaluators = useAvailableEvaluators();

  useEffect(() => {
    if (!checkType && !isChoosing) {
      void router.replace({
        pathname: router.pathname + "/choose",
        query: router.query,
      });
    }
  }, [checkType, isChoosing, router]);

  const evaluatorDefinition = useMemo(
    () => (checkType ? availableEvaluators?.[checkType] : undefined),
    [checkType, availableEvaluators],
  );

  // A monitor can carry a checkType that is no longer in the catalog, either
  // because the evaluator was retired or because this server does not ship it.
  // There is no definition to render settings from, so the form falls back to
  // the picker and names the saved slug there.
  const isRetiredEvaluator = !!checkType && !!availableEvaluators && !evaluatorDefinition;

  // Defaults apply when the chosen evaluator changes, reading the rest as it is then.
  const onEvaluatorChosen = useEffectEvent(() => {
    if (!availableEvaluators || !checkType) return;
    if (defaultValues?.settings && defaultValues.checkType === checkType) return;
    applyEvaluatorDefaults({
      form,
      availableEvaluators,
      checkType,
      nameValue,
      evaluatorDefinition,
      resolvedModels: {
        defaultModel: resolvedDefaultModel.data?.model ?? null,
        embeddingsModel: resolvedDefaultEmbeddings.data?.model ?? null,
      },
    });
  });

  useEffect(() => {
    onEvaluatorChosen();
  }, [
    checkType,
    defaultValues?.checkType,
    defaultValues?.settings,
    resolvedDefaultModel.data?.model,
    resolvedDefaultEmbeddings.data?.model,
  ]);

  const runOn = <RunOnText sample={sample} hasPreconditions={preconditions?.length > 0} />;

  const fields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
  }, [evaluatorDefinition]);

  const runOnHint = runOnHintFor({ preconditions, evaluatorDefinition, sample, runOn });

  return (
    <FormProvider {...form}>
      <form
        onSubmit={handleSubmit((data) => {
          return onSubmit(data);
        })}
        style={{ width: "100%" }}
      >
        {!checkType || isChoosing || !availableEvaluators || !evaluatorDefinition ? (
          <EvaluatorSelection
            form={form}
            retiredEvaluatorType={isRetiredEvaluator ? checkType : undefined}
          />
        ) : (
          <VStack gap={6} align="start" width="full">
            <EvaluatorSummaryCard
              form={form}
              evaluatorDefinition={evaluatorDefinition}
              checkType={checkType}
              isNameAlreadyInUse={isNameAlreadyInUse}
              nameValue={nameValue}
              slug={slug}
            />

            <ExecutionCard
              form={form}
              evaluatorDefinition={evaluatorDefinition}
              checkType={checkType}
              slug={slug}
              watched={{ executionMode, nameValue, settings, storeSettingsOnCode, mappings }}
              preconditions={{
                fields: fieldsPrecondition,
                append: appendPrecondition,
                remove: removePrecondition,
              }}
              targetFields={fields}
              runOn={runOn}
              runOnHint={runOnHint}
            />

            <SaveBar storeSettingsOnCode={storeSettingsOnCode} loading={loading} />
            <TryItOut form={form} />
          </VStack>
        )}
      </form>
    </FormProvider>
  );
}

const legacyMappingsSchema = z.record(z.string(), z.string());

function applyDefaultSettings({
  form,
  defaults,
  prefix,
}: {
  form: UseFormReturn<CheckConfigFormData>;
  defaults: object;
  prefix: string;
}) {
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      applyDefaultSettings({ form, defaults: value, prefix: `${prefix}.${key}` });
      continue;
    }
    // @ts-expect-error: path is built at runtime, not a literal field path
    form.setValue(`${prefix}.${key}`, value);
  }
}

type CheckForm = UseFormReturn<CheckConfigFormData, unknown, CheckConfigFormData>;

function EvaluatorSummaryCard({
  form,
  evaluatorDefinition,
  checkType,
  isNameAlreadyInUse,
  nameValue,
  slug,
}: {
  form: CheckForm;
  evaluatorDefinition: EvaluatorDefinition;
  checkType: string;
  isNameAlreadyInUse: boolean;
  nameValue: string;
  slug: string;
}) {
  const router = useRouter();
  const {
    register,
    formState: { errors },
  } = form;
  const settingsLookup = evaluatorSettingsSchemaFor(checkType);
  return (
    <Card.Root width="full">
      <Card.Body>
        <VStack gap={0}>
          <HorizontalFormControl
            label="Evaluation Type"
            helper="Select the evaluation to run"
            invalid={!!errors.checkType}
          >
            <VStack align="start" width="full">
              <HStack gap={0} width="full">
                <Text>{evaluatorDisplayName(evaluatorDefinition.name)}</Text>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    void router.push({
                      pathname: router.pathname + "/choose",
                      query: router.query,
                    });
                  }}
                  marginLeft={4}
                  fontWeight="normal"
                  color="fg.muted"
                >
                  <Edit2 size={14} />
                </Button>
              </HStack>
              <Text fontSize="12px" color="fg.muted">
                {evaluatorDefinition.description}
              </Text>
            </VStack>
          </HorizontalFormControl>
          <HorizontalFormControl
            label="Name"
            helper="Used to identify the check and call it from the API"
            invalid={!!errors.name}
            align="start"
          >
            <VStack gap={2} align="start">
              <Input
                id="name"
                {...register("name", {
                  required: true,
                })}
              />
              {isNameAlreadyInUse && (
                <Text color="red.500" fontSize="13px">
                  An evaluation with the same name already exists, please choose a different name to
                  have a different slug identifier as well
                </Text>
              )}
              <Text fontSize="12px" paddingLeft={4}>
                {nameValue && "slug: "}
                {slug}
              </Text>
            </VStack>
          </HorizontalFormControl>
          {settingsLookup.found && (
            <DynamicZodForm
              schema={settingsLookup.schema}
              evaluatorType={checkType}
              prefix="settings"
              errors={errors.settings}
              skipFields={["max_tokens"]}
            />
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function ExecutionCard({
  form,
  evaluatorDefinition,
  checkType,
  slug,
  watched,
  preconditions,
  targetFields,
  runOn,
  runOnHint,
}: {
  form: CheckForm;
  evaluatorDefinition: EvaluatorDefinition;
  checkType: string;
  slug: string;
  watched: Pick<
    CheckConfigFormData,
    "executionMode" | "settings" | "storeSettingsOnCode" | "mappings"
  > & { nameValue: string };
  preconditions: {
    fields: ComponentProps<typeof PreconditionsField>["fields"];
    append: ComponentProps<typeof PreconditionsField>["append"];
    remove: ComponentProps<typeof PreconditionsField>["remove"];
  };
  targetFields: ComponentProps<typeof EvaluatorTracesMapping>["targetFields"];
  runOn: ReactNode;
  runOnHint: ReactNode;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const { executionMode, nameValue, settings, storeSettingsOnCode, mappings } = watched;
  const {
    fields: fieldsPrecondition,
    append: appendPrecondition,
    remove: removePrecondition,
  } = preconditions;
  const fields = targetFields;
  const accordionIndex = checkType?.startsWith("custom/") ? 0 : undefined;
  const [accordionValue, setAccordionValue] = useState(accordionIndex ? ["0"] : []);
  const settingsLookup = evaluatorSettingsSchemaFor(checkType);
  return (
    <Card.Root width="full" padding={0}>
      <Card.Body padding={0}>
        <VStack paddingX={4} gap={0}>
          <HorizontalFormControl
            label="Execution Mode"
            helper="Configure when this evaluation is executed"
            invalid={!!errors.executionMode}
            align="start"
            _last={{ borderBottomWidth: "1px" }}
          >
            <NativeSelect.Root>
              <NativeSelect.Field {...register("executionMode")}>
                <option value={EvaluationExecutionMode.ON_MESSAGE}>When message arrives</option>
                {evaluatorDefinition?.isGuardrail && (
                  <option value={EvaluationExecutionMode.AS_GUARDRAIL}>As a Guardrail</option>
                )}
                <option value={EvaluationExecutionMode.MANUALLY}>Manually</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HorizontalFormControl>
          {executionMode !== EvaluationExecutionMode.ON_MESSAGE && (
            <EvaluationManualIntegration
              slug={slug}
              evaluatorDefinition={evaluatorDefinition}
              form={form}
              checkType={checkType}
              name={nameValue}
              executionMode={executionMode}
              settings={settings}
              storeSettingsOnCode={storeSettingsOnCode ?? false}
            />
          )}
        </VStack>

        {executionMode === EvaluationExecutionMode.ON_MESSAGE && (
          <Accordion.Root
            value={accordionValue}
            onValueChange={({ value }) => {
              setAccordionValue(value);
            }}
            multiple
          >
            <Accordion.Item value="0">
              <Accordion.ItemTrigger padding={4} paddingBottom={6}>
                <Field.Root>
                  <VStack align="start" gap={1}>
                    <Field.Label margin={0}>Execution Settings</Field.Label>
                    <Field.HelperText margin={0} fontSize="13px">
                      Configure how and when this evaluation is executed when a new message arrives
                    </Field.HelperText>
                  </VStack>
                </Field.Root>
                <Accordion.ItemIndicator>
                  <ChevronDown />
                </Accordion.ItemIndicator>
              </Accordion.ItemTrigger>
              <Accordion.ItemContent paddingX={4}>
                <HorizontalFormControl
                  label="Mappings"
                  helper="Map which fields from the trace will be used to run the evaluation"
                >
                  <EvaluatorTracesMapping
                    targetFields={fields}
                    traceMapping={mappings}
                    setTraceMapping={(mapping) => {
                      form.setValue("mappings", mapping);
                    }}
                  />
                </HorizontalFormControl>
                <PreconditionsField
                  runOn={runOnHint}
                  append={appendPrecondition}
                  remove={removePrecondition}
                  fields={fieldsPrecondition}
                />
                {settingsLookup.found && (
                  <DynamicZodForm
                    schema={settingsLookup.schema}
                    evaluatorType={checkType}
                    prefix="settings"
                    errors={errors.settings}
                    onlyFields={["max_tokens"]}
                  />
                )}
                <HorizontalFormControl
                  label="Sampling"
                  helper="Run this check only on a sample of messages (min 0.01, max 1.0)"
                  invalid={!!errors.sample}
                  align="start"
                >
                  <Controller
                    control={control}
                    name="sample"
                    render={({ field }) => (
                      <VStack align="start">
                        <HStack>
                          <Input
                            width="110px"
                            type="number"
                            min="0"
                            max="1"
                            step="0.1"
                            placeholder="0.0"
                            {...field}
                            onChange={(e) => field.onChange(+e.target.value)}
                          />
                          <Tooltip content="You can use this to save costs on expensive checks if you have too many messages incomming. From 0.01 to run on 1% of the messages to 1.0 to run on 100% of the messages">
                            <HelpCircle width="14px" />
                          </Tooltip>
                        </HStack>
                        {runOn}
                      </VStack>
                    )}
                  />
                </HorizontalFormControl>
              </Accordion.ItemContent>
            </Accordion.Item>
          </Accordion.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function SaveBar({
  storeSettingsOnCode,
  loading,
}: {
  storeSettingsOnCode?: boolean;
  loading: boolean;
}) {
  return (
    <HStack width="full">
      <Spacer />
      <Tooltip
        content={
          storeSettingsOnCode
            ? 'You checked the "Store the settings on code" option, so the evaluation is configured directly on your codebase, saving is disabled'
            : undefined
        }
      >
        <Button
          colorPalette="orange"
          type="submit"
          minWidth="92px"
          loading={loading}
          disabled={storeSettingsOnCode}
        >
          Save
        </Button>
      </Tooltip>
    </HStack>
  );
}

function checkConfigResolver(
  validateNameUniqueness: (name: string) => Promise<boolean>,
): Resolver<CheckConfigFormData> {
  return (data, context, options) => {
    // A saved monitor can name an evaluator this server no longer has, so the
    // schema lookup is by presence rather than by type.

    const schema: z.ZodType<CheckConfigFormData, CheckConfigFormData> = z.object({
      name: z.string().min(1).max(255).refine(validateNameUniqueness),
      checkType: evaluatorTypesSchema,
      sample: z.number().min(0.01).max(1),
      preconditions: checkPreconditionsSchema,
      settings: formSettingsSchema(data.checkType),
      executionMode: z
        .enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ])
        .optional(),
      mappings: mappingStateSchema,
    });
    return zodResolver(schema)({ ...data, settings: data.settings || {} }, context, options);
  };
}

function applyEvaluatorDefaults({
  form,
  availableEvaluators,
  checkType,
  nameValue,
  evaluatorDefinition,
  resolvedModels,
}: {
  form: CheckForm;
  availableEvaluators: Readonly<Record<string, EvaluatorDefinition>>;
  checkType: string;
  nameValue: string;
  evaluatorDefinition: EvaluatorDefinition | undefined;
  resolvedModels: { defaultModel: string | null; embeddingsModel: string | null };
}) {
  const defaultName = findEvaluatorDefinitions(checkType)[0]?.name;
  const allDefaultNames = Object.values(availableEvaluators).map((evaluator) =>
    evaluatorDisplayName(evaluator.name),
  );
  if (!nameValue || allDefaultNames.includes(nameValue)) {
    const name = defaultName ? evaluatorDisplayName(defaultName) : "";
    form.setValue("name", checkType.includes("custom") ? "" : name);
  }
  applyDefaultSettings({
    form,
    defaults: getEvaluatorDefaultSettings(evaluatorDefinition, resolvedModels, {
      defaultModel: DEFAULT_MODEL,
      embeddingsModel: DEFAULT_EMBEDDINGS_MODEL,
    }),
    prefix: "settings",
  });
}

function RunOnText({ sample, hasPreconditions }: { sample: number; hasPreconditions: boolean }) {
  return (
    <Text color="fg.muted" fontStyle="italic">
      This check will run on{" "}
      {sample >= 1 ? "every message" : `${+(sample * 100).toFixed(2)}% of messages`}
      {hasPreconditions && " matching the preconditions"}
    </Text>
  );
}

function runOnHintFor({
  preconditions,
  evaluatorDefinition,
  sample,
  runOn,
}: {
  preconditions: CheckPreconditions | undefined;
  evaluatorDefinition: EvaluatorDefinition | undefined;
  sample: number;
  runOn: ReactNode;
}): ReactNode {
  const shows =
    preconditions?.length === 0 && !evaluatorDefinition?.requiredFields.includes("contexts");
  if (!shows) return null;
  if (sample === 1) return runOn;
  return (
    <Text color="fg.muted" fontStyle="italic">
      No preconditions defined
    </Text>
  );
}

/** Custom evaluators carry no settings; an unknown built-in falls back to the basic one's. */
function formSettingsSchema(
  checkType: string | undefined,
): z.ZodType<Record<string, unknown>, Record<string, unknown>> {
  if (checkType?.startsWith("custom/")) return z.object({});
  const basic = evaluatorsSchema.shape["langevals/basic"].shape.settings;
  if (!checkType) return basic;
  const lookup = evaluatorSettingsSchemaFor(checkType);
  return lookup.found ? lookup.schema : basic;
}
