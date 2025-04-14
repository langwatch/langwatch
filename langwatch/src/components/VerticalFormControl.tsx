import { Box, Field, VStack, type SystemStyleObject } from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";

export function VerticalFormControl({
  label,
  helper,
  invalid,
  children,
  inputWidth,
  onClick,
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper?: string | ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  onClick?: () => void;
}> &
  SystemStyleObject) {
  return (
    <Field.Root
      borderBottomWidth="1px"
      paddingY={5}
      invalid={invalid}
      _last={{ border: "none" }}
      onClick={onClick}
      {...props}
    >
      <VStack width="full" align="start" gap={3}>
        <VStack align="start" gap={1} width="full">
          <Field.Label margin={0}>{label}</Field.Label>
          <Field.HelperText margin={0} fontSize="13px">
            {helper}
          </Field.HelperText>
        </VStack>
        <Box width="full" minWidth={inputWidth ?? "full"}>
          {children}
        </Box>
      </VStack>
    </Field.Root>
  );
}
