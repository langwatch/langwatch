/** Labelled form row (label/helper/control/error). Narrowed copy with only
 * dataset-needed props and layout.
 */

import { Box, Field, HStack, Spacer, VStack } from "@chakra-ui/react";
import type { PropsWithChildren, ReactNode } from "react";

export function LabelledField({
  label,
  helper,
  invalid,
  children,
}: PropsWithChildren<{
  label: ReactNode;
  helper?: ReactNode;
  invalid?: boolean;
}>) {
  return (
    <Field.Root borderBottomWidth="1px" paddingY={5} invalid={invalid} _last={{ border: "none" }}>
      <HStack width="full" flexDirection={["column", "column", "row"]} gap={4} align="start">
        <VStack align="start" gap={1} width="full">
          <Field.Label margin={0}>{label}</Field.Label>
          <Field.HelperText margin={0} fontSize="13px">
            {helper}
          </Field.HelperText>
        </VStack>
        <Spacer />
        <Box minWidth={["full", "full", "50%"]}>{children}</Box>
      </HStack>
    </Field.Root>
  );
}
