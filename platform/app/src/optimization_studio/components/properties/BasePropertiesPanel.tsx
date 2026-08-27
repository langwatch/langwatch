import type { ComponentProps } from "react";

import {
  FieldsDefinition,
  FieldsForm,
  PropertyField,
  WorkflowBasePropertiesPanel,
  WorkflowPropertySectionTitle,
  type WorkflowPropertySectionTitleProps,
} from "@langwatch/workflow-web";

import { HoverableBigText } from "../../../components/HoverableBigText";
import { toaster } from "../../../components/ui/toaster";
import { DEFAULT_MODEL } from "../../../utils/constants";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { OptimizationStudioLLMConfigField } from "./llm-configs/OptimizationStudioLLMConfigField";

export { FieldsDefinition, FieldsForm, PropertyField };
export { WorkflowPropertySectionTitle as PropertySectionTitle };
export type { WorkflowPropertySectionTitleProps as PropertySectionTitleProps };

type BasePropertiesPanelProps = Omit<
  ComponentProps<typeof WorkflowBasePropertiesPanel>,
  | "defaultLlmModel"
  | "onInvalidNodeName"
  | "renderLlmConfigField"
  | "renderNodeIcon"
  | "renderNodeName"
>;

export function BasePropertiesPanel(props: BasePropertiesPanelProps) {
  return (
    <WorkflowBasePropertiesPanel
      {...props}
      defaultLlmModel={DEFAULT_MODEL}
      onInvalidNodeName={(message) => {
        toaster.create({
          title: "Invalid name",
          description: message,
          type: "error",
        });
      }}
      renderLlmConfigField={({ llmConfig, onChange }) => (
        <OptimizationStudioLLMConfigField llmConfig={llmConfig} onChange={onChange} />
      )}
      renderNodeIcon={({ type, cls, size }) => <ComponentIcon type={type} cls={cls} size={size} />}
      renderNodeName={({ name, onClick, cursor }) => (
        <HoverableBigText
          lineClamp={2}
          fontSize="15px"
          fontWeight={500}
          onClick={onClick}
          cursor={cursor}
          overflow="hidden"
          textOverflow="ellipsis"
          expandable={false}
        >
          {name}
        </HoverableBigText>
      )}
    />
  );
}
