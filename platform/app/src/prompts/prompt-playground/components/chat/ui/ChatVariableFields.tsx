import { Box, Button, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { Popover } from "~/components/ui/popover";

/** A variable this run will substitute, and what it is currently worth. */
export interface ChatVariableField {
  identifier: string;
  value: string;
}

interface ChatVariableFieldsProps {
  variables: ChatVariableField[];
  onValueChange: (identifier: string, value: string) => void;
}

/** How much of a set value a chip shows before it gives up and trails off. */
const CHIP_VALUE_MAX_LENGTH = 24;

/**
 * The prompt's variables, on the message box.
 *
 * A run substitutes these, so they belong where the run is started: you can see
 * which ones the prompt takes and fill any of them in without leaving the
 * conversation. They used to live behind a sub-tab, which meant you could send
 * a message with a variable still empty and never be told.
 *
 * One chip each, not a stack of fields — a prompt with ten variables would
 * otherwise bury the message box under a form. A filled one shows what it holds
 * and an empty one says so, and either opens to an editor on click.
 *
 * `input` is never here. The message box is the field for `input`.
 */
export function ChatVariableFields({
  variables,
  onValueChange,
}: ChatVariableFieldsProps) {
  if (variables.length === 0) return null;

  return (
    <HStack
      gap={1.5}
      paddingX={3}
      paddingTop={2}
      paddingBottom={1}
      flexWrap="wrap"
      alignItems="center"
    >
      <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
        Variables
      </Text>
      {variables.map((variable) => (
        <VariableChip
          key={variable.identifier}
          variable={variable}
          onValueChange={onValueChange}
        />
      ))}
    </HStack>
  );
}

function VariableChip({
  variable,
  onValueChange,
}: {
  variable: ChatVariableField;
  onValueChange: (identifier: string, value: string) => void;
}) {
  const isSet = variable.value.trim().length > 0;
  const preview =
    variable.value.length > CHIP_VALUE_MAX_LENGTH
      ? `${variable.value.slice(0, CHIP_VALUE_MAX_LENGTH)}…`
      : variable.value;

  return (
    <Popover.Root positioning={{ placement: "top-start" }}>
      <Popover.Trigger asChild>
        <Button
          size="2xs"
          // An empty variable is the one worth noticing, so it is the outlined
          // one; a filled one settles back into the composer.
          variant={isSet ? "subtle" : "outline"}
          borderStyle={isSet ? "solid" : "dashed"}
          borderRadius="full"
          fontWeight="normal"
          maxWidth="220px"
          overflow="hidden"
          data-testid={`chat-variable-${variable.identifier}`}
          aria-label={`Set ${variable.identifier}`}
        >
          <Text fontFamily="mono" fontSize="xs" flexShrink={0}>
            {variable.identifier}
          </Text>
          {isSet && (
            <Text
              fontSize="xs"
              color="fg.muted"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {preview}
            </Text>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Content width="320px">
        <Popover.Body>
          <VStack align="stretch" gap={2}>
            <Text fontFamily="mono" fontSize="xs" color="fg.muted">
              {variable.identifier}
            </Text>
            <Textarea
              value={variable.value}
              onChange={(event) =>
                onValueChange(variable.identifier, event.target.value)
              }
              placeholder="Value for this run"
              size="sm"
              rows={3}
              maxHeight="200px"
              autoresize
              data-testid={`chat-variable-input-${variable.identifier}`}
            />
            <Box>
              <Text fontSize="xs" color="fg.subtle">
                Substituted into the prompt when you send a message.
              </Text>
            </Box>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
