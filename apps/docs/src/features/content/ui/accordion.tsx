import { Accordion as ChakraAccordion, Box, Flex } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { Icon } from "./icon.tsx";

type AccordionProps = {
  title?: string;
  description?: string;
  icon?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function Accordion({ title, description, icon, defaultOpen, children }: AccordionProps) {
  return (
    <ChakraAccordion.Root
      collapsible
      multiple
      defaultValue={defaultOpen ? ["item"] : []}
      variant="outline"
      marginY="3"
    >
      <ChakraAccordion.Item
        value="item"
        borderRadius="xl"
        borderWidth="1px"
        borderColor="border"
        overflow="hidden"
      >
        <ChakraAccordion.ItemTrigger
          minHeight="52px"
          paddingX="4"
          paddingY="3"
          gap="3"
          cursor="pointer"
        >
          {icon ? <Icon icon={icon} size={18} /> : null}
          <Flex direction="column" flex="1" textAlign="start" minWidth="0">
            <Box as="span" fontSize="16px" lineHeight="24px" fontWeight="500">
              {title}
            </Box>
            {description ? (
              <Box as="span" fontSize="14px" lineHeight="20px" color="fg.muted">
                {description}
              </Box>
            ) : null}
          </Flex>
          <ChakraAccordion.ItemIndicator />
        </ChakraAccordion.ItemTrigger>
        <ChakraAccordion.ItemContent data-docs-panel="">
          <ChakraAccordion.ItemBody paddingX="4" paddingTop="1" paddingBottom="4">
            {children}
          </ChakraAccordion.ItemBody>
        </ChakraAccordion.ItemContent>
      </ChakraAccordion.Item>
    </ChakraAccordion.Root>
  );
}

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return (
    <Flex
      direction="column"
      gap="0"
      marginY="6"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflow="hidden"
      css={{
        "& > *": { margin: "0" },
        "& [data-scope=accordion][data-part=item]": { border: "0", borderRadius: "0" },
        "& > * + *": { borderTop: "1px solid", borderColor: "border.muted" },
      }}
    >
      {children}
    </Flex>
  );
}
