import { Box, Field, HStack, Text } from "@chakra-ui/react";
import { HelpCircle } from "lucide-react";

import { Tooltip } from "../../ui/tooltip";

/**
 * Label with an (i) that carries the full explanation, per copywriting.md.
 *
 * `Field.Label`, not a bare `Text`: inside a `Field.Root` it picks up the
 * generated `htmlFor`, so the input it sits above actually has a name. As
 * plain text it read as a label and was one to nobody — not to a screen
 * reader, and not to anything asking the page what these inputs are.
 */
export function LabelWithHelp({
  label,
  help,
}: {
  label: string;
  help: string;
}) {
  return (
    <Field.Label>
      <HStack gap={1.5} align="center">
        <Text textStyle="sm" fontWeight="medium">
          {label}
        </Text>
        <Tooltip content={help}>
          <Box color="fg.muted" display="flex" cursor="pointer">
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
      </HStack>
    </Field.Label>
  );
}
