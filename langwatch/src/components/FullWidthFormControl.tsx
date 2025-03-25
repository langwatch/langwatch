import { Box, Field, Spacer, VStack, type StackProps } from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";

export function FullWidthFormControl({
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
  helper?: string;
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
