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

export function FullWidthFormControl({
  label,
  helper,
  isInvalid,
  children,
  align,
  minWidth,
  inputWidth,
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper: string;
  isInvalid?: boolean;
  inputWidth?: string;
}> &
  StackProps) {
  return (
    <FormControl paddingY={2} isInvalid={isInvalid} {...props}>
      <VStack width="full" align={align}>
        <VStack align="start" gap={1} width="full" minWidth={minWidth}>
          <FormLabel margin={0}>{label}</FormLabel>
          <FormHelperText margin={0} fontSize="13px">
            {helper}
          </FormHelperText>
        </VStack>
        <Spacer />
        <Spacer />
        <Box>{children}</Box>
      </VStack>
    </FormControl>
  );
}
