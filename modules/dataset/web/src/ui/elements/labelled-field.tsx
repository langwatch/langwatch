/**
 * One labelled row of the dataset form: the label and its helper on the left,
 * the control on the right, an error under the control.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/components/HorizontalFormControl`, which ~90 non-Datasets
 * surfaces still render. Deletes-only forbids repointing them; what travelled is
 * the three props the dataset drawer passes (`label`, `helper`, `invalid`) and
 * the layout, without the tooltip, the size and direction variants or the
 * react-hook-form error rendering, none of which this family uses.
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
