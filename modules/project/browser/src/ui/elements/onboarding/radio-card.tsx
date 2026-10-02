/**
 * A radio option styled as a card; moved from onboarding page to fix
 * component-importing-page dependency.
 */

import { Box } from "@langwatch/design-system/primitives";
import { RawRadioGroup as RadioGroup } from "@langwatch/design-system/radio";
import { forwardRef, type ReactNode } from "react";

type RadioCardProps = {
  value: string;
  children: ReactNode;
};

export const RadioCard = forwardRef<HTMLInputElement, RadioCardProps>(
  function RadioCard(props, ref) {
    const { children, value } = props;

    return (
      <RadioGroup.Item
        value={value}
        _checked={{
          backgroundColor: "gray.50",
        }}
      >
        <RadioGroup.ItemHiddenInput ref={ref} />
        <Box
          cursor="pointer"
          borderRadius="md"
          _hover={{
            backgroundColor: "gray.50",
          }}
          px={3}
          py={3}
          height="full"
          display="flex"
          alignItems="center"
        >
          {children}
        </Box>
      </RadioGroup.Item>
    );
  },
);
