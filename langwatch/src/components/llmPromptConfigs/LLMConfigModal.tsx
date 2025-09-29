import { Button, HStack, Input } from "@chakra-ui/react";
import { Settings } from "react-feather";

import { ConfigModal } from "../../optimization_studio/components/properties/modals/ConfigModal";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { useFormContext } from "react-hook-form";
import { type PromptConfigFormValues } from "~/prompt-configs";

export function LLMConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const model = form.watch("version.configData.llm.model");
  const temperature = form.watch("version.configData.llm.temperature");
  const maxTokens = form.watch("version.configData.llm.max_tokens");

  return (
    <ConfigModal open={open} onClose={onClose} title="LLM Config">
      <HorizontalFormControl
        label="Model"
        helper={"The LLM model to use"}
        inputWidth="55%"
      >
        <HStack width="full" gap={2}>
          <ModelSelector
            model={model ?? ""}
            options={allModelOptions}
            onChange={(model) => form.setValue("version.configData.llm.model", model)}
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
          value={temperature}
          type="number"
          step={0.1}
          min={0}
          max={2}
          onChange={(e) =>
            form.setValue("version.configData.llm.temperature", Number(e.target.value))
          }
        />
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Max Tokens"
        helper={"Limit to avoid expensive outputs"}
        inputWidth="55%"
      >
        <Input
          value={maxTokens}
          type="number"
          step={64}
          min={256}
          max={1048576}
          onChange={(e) =>
            form.setValue("version.configData.llm.max_tokens", Number(e.target.value))
          }
          onBlur={() => {
            // TODO: This shouldn't happen here
            if (maxTokens === 0) {
              form.setValue("version.configData.llm.max_tokens", 2048);
            }
          }}
        />
      </HorizontalFormControl>
    </ConfigModal>
  );
}
