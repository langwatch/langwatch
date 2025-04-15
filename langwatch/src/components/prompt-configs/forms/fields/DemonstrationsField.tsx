import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Edit2, Info } from "react-feather";
import { useFormContext, Controller } from "react-hook-form";
import { DatasetPreview } from "../../../datasets/DatasetPreview";
import { Tooltip } from "../../../ui/tooltip";
import { VerticalFormControl } from "../../../VerticalFormControl";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";
import { useGetDatasetData } from "../../../../optimization_studio/hooks/useGetDatasetData";
import { DemonstrationsModal } from "../../../../optimization_studio/components/DemonstrationsModal";
import type { DatasetColumnType } from "~/server/datasets/types";

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

  const demonstrations = watch("version.demonstrations");
  const total = demonstrations?.rows?.length;

  return (
    <Controller
      name="version.demonstrations"
      control={control}
      render={({ field }) => (
        <VerticalFormControl
          label={<DemonstrationsLabel total={total} onOpen={onOpen} />}
          invalid={!!errors.version?.demonstrations}
          helper={errors.version?.demonstrations?.message?.toString()}
          error={errors.version?.demonstrations}
        >
          <DatasetPreview
            rows={demonstrations.rows}
            columns={demonstrations.columns}
            minHeight={`${36 + 29 * (demonstrations.rows?.length ?? 0)}px`}
          />
          {/* <DemonstrationsModal
              open={open}
              onClose={onClose}
              onChange={field.onChange}
            /> */}
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
        <Text fontSize="sm" fontWeight="medium">
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
