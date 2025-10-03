import { Button, HStack, Input } from "@chakra-ui/react";
import { Settings } from "react-feather";

import { ConfigModal } from "../../optimization_studio/components/properties/modals/ConfigModal";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";

interface LlmConfigModalValues  {
  model: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Controlled LLM Config Modal
 * Can be used outside of the form context (does not use react-hook-form)
 * @param param0 - The props for the LLMConfigModal
 * @param param0.open - Whether the modal is open
 * @param param0.onClose - The function to close the modal
 * @param param0.values - The values for the LLM config
 * @param param0.onChange - The function to change the values
 * @returns 
 */
export function LLMConfigModal({
  open,
  onClose,
  values,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  values: LlmConfigModalValues;
  onChange: (params: LlmConfigModalValues) => void;
}) {
  return (
    <ConfigModal open={open} onClose={onClose} title="LLM Config">
      <HorizontalFormControl
        label="Model"
        helper={"The LLM model to use"}
        inputWidth="55%"
      >
        <HStack width="full" gap={2}>
          <ModelSelector
            model={values?.model ?? ""}
            options={allModelOptions}
            onChange={(model) => onChange({ ...values, model })}
            mode="chat"
            size="full"
          />
          <Tooltip
            content="Configure available models"
            positioning={{ placement: "top" }}
            showArrow
          >
            <Link href="/settings/model-providers" target="_blank" asChild>
              <Button variant="ghost" size="sm">
                <Settings size={16} />
              </Button>
            </Link>
          </Tooltip>
        </HStack>
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Temperature"
        helper={"Controls randomness in the output"}
        inputWidth="55%"
      >
        <Input
          value={values?.temperature}
          type="number"
          step={0.1}
          min={0}
          max={2}
          onChange={(e) =>
            onChange({ ...values, temperature: Number(e.target.value) })
          }
        />
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Max Tokens"
        helper={"Limit to avoid expensive outputs"}
        inputWidth="55%"
      >
        <Input
          value={values?.max_tokens}
          type="number"
          step={64}
          min={256}
          max={1048576}
          onChange={(e) =>
            onChange({ ...values, max_tokens: Number(e.target.value) })
          }
        />
      </HorizontalFormControl>
    </ConfigModal>
  );
}
