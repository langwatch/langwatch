import { Box, Field, Spacer, type StackProps, VStack } from "@chakra-ui/react";
import type { PropsWithChildren, ReactNode } from "react";

export function FullWidthFormControl({
  label,
  helper,
  invalid,
  children,
  align,
  minWidth,
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper?: string | ReactNode;
  invalid?: boolean;
  inputWidth?: string;
}> &
  StackProps) {
  return (
    <Field.Root paddingY={2} invalid={invalid} {...props}>
      <VStack width="full" align={align} gap={helper ? 2 : 1}>
        <VStack align="start" gap={1} width="full" minWidth={minWidth}>
          <Field.Label margin={0}>{label}</Field.Label>
          {helper && (
            <Field.HelperText margin={0} fontSize="13px">
              {helper}
            </Field.HelperText>
          )}
        </VStack>
        <Spacer />
        <Spacer />
        <Box>{children}</Box>
      </VStack>
    </Field.Root>
  );
}
