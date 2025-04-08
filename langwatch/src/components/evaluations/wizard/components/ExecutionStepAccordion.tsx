import { StepAccordion, type StepAccordionProps } from "./StepAccordion";
/**
 * Same as the StepAccordion, but with defaults
 *
 * @param props - The props for the StepAccordion
 * @param props.borderColor - The border color of the accordion (default: orange.400)
 * @param props.width - The width of the accordion (default: full)
 * @returns The ExecutionStepAccordion component
 */
export function ExecutionStepAccordion(props: StepAccordionProps) {
  const { borderColor = "orange.400", width = "full", ...rest } = props;

  return (
    <StepAccordion
      {...{
        borderColor,
        width,
        ...rest,
      }}
    />
  );
}
