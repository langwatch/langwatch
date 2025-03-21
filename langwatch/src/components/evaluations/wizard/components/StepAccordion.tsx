import { HStack, Text, VStack } from "@chakra-ui/react";

import { Accordion } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";

export function StepAccordion({
  children,
  title,
  borderColor,
  value,
  showTrigger = true,
  ...props
}: {
  children: React.ReactNode;
  title: string | React.ReactNode;
  value: string;
  borderColor: string;
  showTrigger?: boolean;
} & Omit<Accordion.ItemProps, "title">) {
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
            <Accordion.ItemIndicator>
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
