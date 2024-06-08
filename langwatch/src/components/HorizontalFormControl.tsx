import {
  Box,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Spacer,
  VStack,
  type StackProps,
} from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";

export function HorizontalFormControl({
  label,
  helper,
  isInvalid,
  children,
  align,
  minWidth,
}: PropsWithChildren<{
  label: string | ReactNode;
  helper: string;
  isInvalid?: boolean;
}> &
  StackProps) {
  return (
    <FormControl
      borderBottomWidth="1px"
      paddingY={4}
      isInvalid={isInvalid}
      _last={{ border: "none" }}
    >
      <HStack
        width="full"
        flexDirection={["column", "column", "row"]}
        align={align}
      >
        <VStack align="start" spacing={1} width="full" minWidth={minWidth}>
          <FormLabel margin={0}>{label}</FormLabel>
          <FormHelperText margin={0} fontSize={12}>
            {helper}
          </FormHelperText>
        </VStack>
        <Spacer />
        <Box minWidth={["full", "full", "50%"]}>{children}</Box>
      </HStack>
    </FormControl>
  );
}
