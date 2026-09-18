import { HStack, Spacer, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type PromptConfigFormValues } from "@langwatch/prompt-contract";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";
import { Info } from "lucide-react";
import { useFormContext } from "react-hook-form";

import { VerticalFormControl } from "../../../../ui/elements/vertical-form-control.tsx";
import { DatasetPreview } from "./dataset-preview.tsx";

/**
 * The few-shot examples a prompt carries, shown read-only - a narrowed
 * family-local copy of `platform/app`'s `DemonstrationsField.tsx`. Still
 * edited through the prompt editor drawer, opened from workflow studio/experiments.
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
