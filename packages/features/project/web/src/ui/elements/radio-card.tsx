/**
 * A radio option shaped like a card.
 *
 * Moved out of `platform/app/src/pages/onboarding/[team]/project.tsx`, which
 * declared it beside the page that used it and exported it for `TechStack` to
 * import — a component reaching into a PAGE, which is what kept the tech-stack
 * selector from moving anywhere. It is an element here, and the dependency runs
 * the right way round.
 */

import { Box, RadioGroup } from "@chakra-ui/react";
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
          px={5}
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
