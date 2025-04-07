import { Button, HStack, Input } from "@chakra-ui/react";
import { Settings } from "react-feather";
import { HorizontalFormControl } from "../../../../../components/HorizontalFormControl";
import {
  allModelOptions,
  ModelSelector,
} from "../../../../../components/ModelSelector";
import type { LLMConfig } from "../../../../types/dsl";
import { ConfigModal } from "../ConfigModal";
import { Link } from "../../../../../components/ui/link";
import { Tooltip } from "../../../../../components/ui/tooltip";

export function LLMConfigModal({
  open,
  onClose,
  llmConfig,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
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
            model={llmConfig.model ?? ""}
            options={allModelOptions}
            onChange={(model) => onChange({ ...llmConfig, model })}
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
          value={llmConfig.temperature}
          type="number"
          step={0.1}
          min={0}
          max={2}
          onChange={(e) =>
            onChange({ ...llmConfig, temperature: Number(e.target.value) })
          }
        />
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Max Tokens"
        helper={"Limit to avoid expensive outputs"}
        inputWidth="55%"
      >
        <Input
          value={llmConfig.max_tokens}
          type="number"
          step={64}
          min={256}
          max={1048576}
          onChange={(e) =>
            onChange({ ...llmConfig, max_tokens: Number(e.target.value) })
          }
          onBlur={() => {
            if (llmConfig.max_tokens === 0) {
              onChange({ ...llmConfig, max_tokens: 2048 });
            }
          }}
        />
      </HorizontalFormControl>
    </ConfigModal>
  );
}
