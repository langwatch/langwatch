import { HStack, Spacer, Text } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { DatasetPreview } from "./dataset-preview";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { VerticalFormControl } from "../../../ui/elements/vertical-form-control";
import type { PromptConfigFormValues } from "../../../surfaces/prompt-form";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-web";

/**
 * The few-shot examples a prompt carries, shown read-only.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/prompts/forms/fields/DemonstrationsField.tsx`, which the
 * workflow studio's signature panel also renders, so the platform copy stays
 * and keeps its editor.
 *
 * EDITING DID NOT TRAVEL, and it is a recorded loss. The Edit button opened
 * `DatasetEditorTable` — 937 lines of spreadsheet with four non-Datasets
 * callers, whose in-memory branch the datasets family deliberately dropped when
 * it narrowed its own copy into `@langwatch/dataset-web`. Rebuilding that branch
 * on the primitives that package publishes is the datasets feature's work, not
 * a page move's. Demonstrations still render, and the prompt editor drawer —
 * still `platform/app`'s, opened from the workflow studio and the experiments
 * workbench — still edits them.
 */
export function DemonstrationsField() {
  const { watch, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;
  const demonstrations = watch("version.configData.demonstrations");
  const transposedRecords = transposeColumnsFirstToRowsFirstWithId(
    demonstrations?.inline?.records ?? {},
  );
  const total = transposedRecords.length;

  if (total === 0) {
    return null;
  }

  // The `Controller` wrapper went with the editor: nothing here writes the
  // field any more, and a controller whose render never touches its field is
  // just a subscription the `watch` above already made.
  return (
    <VerticalFormControl
      label={<DemonstrationsLabel total={total} />}
      invalid={!!errors.version?.configData?.demonstrations}
      helper={errors.version?.configData?.demonstrations?.message?.toString()}
      error={errors.version?.configData?.demonstrations}
      size="sm"
    >
      <DatasetPreview
        rows={transposedRecords}
        columns={demonstrations?.inline?.columnTypes ?? []}
        minHeight={`${36 + 29 * (total ?? 0)}px`}
      />
    </VerticalFormControl>
  );
}

function DemonstrationsLabel({ total }: { total: number }) {
  return (
    <HStack width="full" align="center">
      <HStack gap={2} align="center">
        <Text>
          Demonstrations{" "}
          {total !== undefined && total > 0 && (
            <Text as="span" color="fg.subtle">
              ({total} rows)
            </Text>
          )}
        </Text>
        <Tooltip content="Few-shot examples to guide the LLM to generate the correct output.">
          <Info size={14} />
        </Tooltip>
      </HStack>
      <Spacer />
    </HStack>
  );
}
