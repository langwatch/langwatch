import {
  Box,
  Field,
  HStack,
  Spacer,
  VStack,
  type SystemStyleObject,
} from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";

export function HorizontalFormControl({
  label,
  helper,
  invalid,
  children,
  minWidth,
  inputWidth,
  align,
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper: string | ReactNode;
  invalid?: boolean;
  inputWidth?: string;
}> &
  SystemStyleObject & {
    align?: "start" | "end";
  }) {
  return (
    <Field.Root
      borderBottomWidth="1px"
      paddingY={5}
      invalid={invalid}
      _last={{ border: "none" }}
      {...props}
    >
      <HStack
        width="full"
        flexDirection={["column", "column", "row"]}
        align={align}
      >
        <VStack align="start" gap={1} width="full" minWidth={minWidth}>
          <Field.Label margin={0}>{label}</Field.Label>
          <Field.HelperText margin={0} fontSize="13px">
            {helper}
          </Field.HelperText>
        </VStack>
        <Spacer />
        <Box minWidth={["full", "full", inputWidth ?? "50%"]}>{children}</Box>
      </HStack>
    </Field.Root>
  );
}
