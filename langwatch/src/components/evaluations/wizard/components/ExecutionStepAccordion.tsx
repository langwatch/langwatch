import { StepAccordion, type StepAccordionProps } from "./StepAccordion";
import {
  FieldsForm,
  FieldsDefinition,
} from "~/optimization_studio/components/properties/BasePropertiesPanel";
import type { Node } from "@xyflow/react";
import type { Component, Field } from "~/optimization_studio/types/dsl";
import { VStack } from "@chakra-ui/react";

/**
 * A compound component for execution step accordions with parameters, inputs, and outputs fields.
 *
 * This exports wrappers around field components (ie. StepAccordion, FieldsForm, FieldsDefinition) to allow the exectution accordions
 * to diverge gracefully and set standard defaults.
 */
const ExecutionStepAccordionRoot = (props: StepAccordionProps) => {
  const {
    borderColor = "orange.400",
    width = "full",
    children,
    ...rest
  } = props;

  return (
    <StepAccordion borderColor={borderColor} width={width} {...rest}>
      <VStack width="full" gap={3}>
        {children}
      </VStack>
    </StepAccordion>
  );
};

interface ParametersFieldProps {
  node: Node<Component>;
}

const ParametersField = ({ node }: ParametersFieldProps) => {
  return <FieldsForm node={node} field="parameters" />;
};

interface FieldsProps {
  node: Node<Component>;
  title?: string;
  onChange?: (data: { fields: Field[] }) => void;
}

const InputField = ({ node, title = "Inputs", onChange }: FieldsProps) => {
  return (
    <FieldsDefinition
      node={node}
      field="inputs"
      title={title}
      onChange={onChange}
    />
  );
};

const OutputField = ({ node, title = "Outputs", onChange }: FieldsProps) => {
  return (
    <FieldsDefinition
      node={node}
      field="outputs"
      title={title}
      onChange={onChange}
    />
  );
};

/**
 * ExecutionStepAccordion is a compound component for creating execution step accordions
 * with standardized parameters, inputs, and outputs fields.
 *
 * Usage:
 * <ExecutionStepAccordion.Root value="my_step" title="My Step">
 *   <VStack width="full" gap={3}>
 *     <ExecutionStepAccordion.ParametersField node={myNode} />
 *     <ExecutionStepAccordion.InputField
 *       node={myNode}
 *       title="Inputs"
 *       onChange={handleInputChange}
 *     />
 *     <ExecutionStepAccordion.OutputField
 *       node={myNode}
 *       title="Outputs"
 *       onChange={handleOutputChange}
 *     />
 *   </VStack>
 * </ExecutionStepAccordion.Root>
 */
export const ExecutionStepAccordion = Object.assign(
  // For backward compatibility
  function ExecutionStepAccordion(props: StepAccordionProps) {
    const { borderColor = "orange.400", width = "full", ...rest } = props;
    return <StepAccordion borderColor={borderColor} width={width} {...rest} />;
  },
  {
    Root: ExecutionStepAccordionRoot,
    ParametersField,
    InputField,
    OutputField,
  }
);
