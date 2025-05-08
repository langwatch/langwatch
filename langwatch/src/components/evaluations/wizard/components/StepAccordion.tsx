import { HStack, Text, VStack } from "@chakra-ui/react";
import { Accordion } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";

export interface StepAccordionProps extends Omit<Accordion.ItemProps, "title"> {
  children: React.ReactNode;
  title: string | React.ReactNode;
  value: string;
  borderColor?: string;
  showTrigger?: boolean;
  indicatorProps?: Accordion.ItemIndicatorProps;
}

export function StepAccordion({
  children,
  title,
  borderColor,
  value,
  showTrigger = true,
  indicatorProps,
  ...props
}: StepAccordionProps) {
  return (
    <Accordion.Item value={value} width="full" {...props}>
      {showTrigger && (
        <Accordion.ItemTrigger
          width="full"
          paddingY={3}
          paddingRight={2}
          paddingLeft={4}
          borderLeftWidth={3}
          borderColor={borderColor}
        >
          <HStack width="full" alignItems="center">
            <VStack width="full" align="start" gap={1}>
              {typeof title === "string" ? <Text>{title}</Text> : title}
            </VStack>
            <Accordion.ItemIndicator {...indicatorProps}>
              <LuChevronDown />
            </Accordion.ItemIndicator>
          </HStack>
        </Accordion.ItemTrigger>
      )}
      <Accordion.ItemContent paddingTop={2} paddingX="1px">
        {children}
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}
