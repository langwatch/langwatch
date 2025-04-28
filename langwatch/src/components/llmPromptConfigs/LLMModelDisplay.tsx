import { Box } from "@chakra-ui/react";

import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { OverflownTextWithTooltip } from "../OverflownText";

export function LLMModelDisplay({
  model,
  fontSize = "14px",
}: {
  model: string;
  fontSize?: string;
}) {
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat"
  );

  const isDisabled = modelOption?.isDisabled ?? !modelOption?.label;

  return (
    <>
      {modelOption?.icon && (
        <Box width="14px" minWidth="14px">
          {modelOption?.icon}
        </Box>
      )}
      <OverflownTextWithTooltip
        label={`${modelOption?.label ?? model} ${
          modelOption?.isDisabled
            ? "(disabled)"
            : !modelOption?.label
            ? "(deprecated)"
            : ""
        }`}
        fontSize={fontSize}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isDisabled ? "gray.500" : undefined}
        textDecoration={isDisabled ? "line-through" : undefined}
      >
        {modelOption?.label ?? model}
      </OverflownTextWithTooltip>
    </>
  );
}
