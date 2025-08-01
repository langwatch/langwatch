import { Button, HStack, Spacer, Text, useDisclosure } from "@chakra-ui/react";
import { Edit2, Info } from "react-feather";
import { useFormContext, Controller } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";
import { DemonstrationsModal } from "../../modals/DemonstrationsModal";

import { DatasetPreview } from "~/components/datasets/DatasetPreview";
import { Tooltip } from "~/components/ui/tooltip";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { transposeColumnsFirstToRowsFirstWithId } from "../../../optimization_studio/utils/datasetUtils";

/**
 * Field for managing demonstrations (few-shot examples) in prompt configurations
 *
 * Allows users to view and edit demonstrations that guide the LLM
 * to generate the correct output.
 */
export function DemonstrationsField() {
  const { control, watch, formState } =
    useFormContext<PromptConfigFormValues>();
  const { errors } = formState;
  const { open, onOpen, onClose } = useDisclosure();
  const demonstrations = watch("version.configData.demonstrations");
  const transposedRecords = transposeColumnsFirstToRowsFirstWithId(
    demonstrations?.inline?.records ?? {}
  );
  const total = transposedRecords.length;

  return (
    <Controller
      name="version.configData.demonstrations"
      control={control}
      render={({ field }) => (
        <VerticalFormControl
          label={<DemonstrationsLabel total={total} onOpen={onOpen} />}
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
          <DemonstrationsModal
            open={open}
            onClose={onClose}
            demonstrations={demonstrations}
            onChange={(demonstrations) => {
              field.onChange(demonstrations);
            }}
          />
        </VerticalFormControl>
      )}
    />
  );
}

function DemonstrationsLabel({
  total,
  onOpen,
}: {
  total: number;
  onOpen: () => void;
}) {
  return (
    <HStack width="full" align="center">
      <HStack gap={2} align="center">
        <Text>
          Demonstrations{" "}
          {total !== undefined && total > 0 && (
            <Text as="span" color="gray.400">
              ({total} rows)
            </Text>
          )}
        </Text>
        <Tooltip content="Few-shot examples to guide the LLM to generate the correct output.">
          <Info size={14} />
        </Tooltip>
      </HStack>
      <Spacer />
      <Button size="xs" variant="ghost" marginBottom={-1} onClick={onOpen}>
        <Edit2 size={14} />
        <Text>Edit</Text>
      </Button>
    </HStack>
  );
}
