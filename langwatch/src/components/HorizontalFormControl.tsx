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
  invalid,
  children,
  align,
  minWidth,
  inputWidth,
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper: string;
  invalid?: boolean;
  inputWidth?: string;
}> &
  StackProps) {
  return (
    <FormControl
      borderBottomWidth="1px"
      paddingY={5}
      isInvalid={invalid}
      _last={{ border: "none" }}
      {...props}
    >
      <HStack
        width="full"
        flexDirection={["column", "column", "row"]}
        align={align}
      >
        <VStack align="start" gap={1} width="full" minWidth={minWidth}>
          <FormLabel margin={0}>{label}</FormLabel>
          <FormHelperText margin={0} fontSize={13}>
            {helper}
          </FormHelperText>
        </VStack>
        <Spacer />
        <Box minWidth={["full", "full", inputWidth ?? "50%"]}>{children}</Box>
      </HStack>
    </FormControl>
  );
}
