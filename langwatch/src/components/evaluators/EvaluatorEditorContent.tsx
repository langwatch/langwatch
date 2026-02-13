import {
  Box,
  Field,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { FormProvider } from "react-hook-form";
import type { ZodType } from "zod";
import DynamicZodForm from "~/components/checks/DynamicZodForm";
import { Link } from "~/components/ui/link";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { WorkflowCardDisplay } from "~/optimization_studio/components/workflow/WorkflowCard";
import { EvaluatorMappingsSection } from "./EvaluatorMappingsSection";
import type { EvaluatorMappingsConfig } from "./EvaluatorEditorDrawer";

/**
 * Props for the evaluator editor content.
 * This is a "view" component -- it does not manage API calls or mutations.
 * All data and callbacks are provided by the parent.
 */
export type EvaluatorEditorContentProps = {
  /** Evaluator type key (e.g., "langevals/exact_match") */
  evaluatorType?: string;
  /** Human-readable name from AVAILABLE_EVALUATORS */
  description?: string;
  /** Whether this evaluator is backed by a workflow */
  isWorkflowEvaluator?: boolean;
  /** Workflow metadata for displaying the workflow card */
  workflow?: {
    id: string;
    name: string;
    icon?: string | null;
    updatedAt: Date;
    projectSlug: string;
  };
  /** react-hook-form instance for name + settings */
  form: UseFormReturn<{ name: string; settings: Record<string, unknown> }>;
  /** Zod schema for the settings form (passed to DynamicZodForm) */
  settingsSchema?: ZodType;
  /** Whether the settings schema has any fields */
  hasSettings: boolean;

  /**
   * Effective evaluator definition used for mappings.
   * This may come from AVAILABLE_EVALUATORS or from pre-computed backend fields.
   */
  effectiveEvaluatorDef?: {
    requiredFields?: string[];
    optionalFields?: string[];
  };

  /** Optional mapping configuration. When provided, the mappings section is shown. */
  mappingsConfig?: EvaluatorMappingsConfig;

  /** Visual variant for styling differences between drawer and studio contexts */
  variant?: "drawer" | "studio";
};

/**
 * Reusable evaluator editor body content.
 * Renders the description, name input, settings form, workflow card, and mappings.
 * Used by both EvaluatorEditorDrawer and (in the future) EvaluatorPropertiesPanel.
 */
export function EvaluatorEditorContent({
  evaluatorType,
  description,
  isWorkflowEvaluator,
  workflow,
  form,
  settingsSchema,
  hasSettings,
  effectiveEvaluatorDef,
  mappingsConfig,
  variant: _variant = "drawer",
}: EvaluatorEditorContentProps) {
  return (
    <FormProvider {...form}>
      <VStack
        gap={4}
        align="stretch"
        flex={1}
        paddingX={6}
        paddingY={4}
        overflowY="auto"
      >
        {/* Description */}
        {description && (
          <Text fontSize="sm" color="fg.muted">
            {description}
          </Text>
        )}

        {/* Name field */}
        <Field.Root required>
          <Field.Label>Evaluator Name</Field.Label>
          <Input
            {...form.register("name")}
            placeholder="Enter evaluator name"
            data-testid="evaluator-name-input"
          />
        </Field.Root>

        {/* Settings fields using DynamicZodForm */}
        {hasSettings && evaluatorType && settingsSchema && (
          <DynamicZodForm
            schema={settingsSchema}
            evaluatorType={evaluatorType as EvaluatorTypes}
            prefix="settings"
            errors={form.formState.errors.settings}
            variant="default"
          />
        )}

        {/* Workflow card - always shown for workflow evaluators */}
        {isWorkflowEvaluator && workflow && (
          <VStack gap={4} paddingTop={4} align="stretch">
            <Text fontSize="sm" color="fg.muted">
              This evaluator is powered by a workflow. Click below to
              open the workflow editor:
            </Text>
            <Link
              href={`/${workflow.projectSlug}/studio/${workflow.id}`}
              data-testid="open-workflow-link"
              target="_blank"
            >
              <WorkflowCardDisplay
                name={workflow.name}
                icon={workflow.icon}
                updatedAt={workflow.updatedAt}
                action={
                  <ExternalLink
                    size={16}
                    color="var(--chakra-colors-fg-muted)"
                  />
                }
                width="300px"
              />
            </Link>
          </VStack>
        )}

        {/* No settings message - only for non-workflow evaluators with no settings and no mappings */}
        {!hasSettings && !mappingsConfig && !isWorkflowEvaluator && (
          <Text fontSize="sm" color="fg.muted">
            This evaluator does not have any settings to configure.
          </Text>
        )}

        {/* Mappings section - shown when caller provides mappingsConfig */}
        {mappingsConfig && (
          <Box paddingTop={4}>
            <EvaluatorMappingsSection
              evaluatorDef={effectiveEvaluatorDef}
              level={mappingsConfig.level}
              providedSources={mappingsConfig.availableSources}
              initialMappings={mappingsConfig.initialMappings}
              onMappingChange={mappingsConfig.onMappingChange}
              scrollToMissingOnMount={true}
            />
          </Box>
        )}
      </VStack>
    </FormProvider>
  );
}
