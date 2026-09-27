import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";

/** Editable regular-expression rows, each with its own validation message and remove button. */
export function PatternListField({
  patterns,
  onChange,
  errorOf,
  placeholder,
  label,
  removeLabel,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
  errorOf: (pattern: string) => string | null;
  placeholder: string;
  label: string;
  removeLabel: string;
}) {
  return (
    <>
      {patterns.map((pattern, index) => {
        const error = errorOf(pattern);
        return (
          <VStack key={index} gap={1} align="stretch">
            <HStack gap={2}>
              <Input
                size="sm"
                fontFamily="mono"
                placeholder={placeholder}
                value={pattern}
                aria-label={`${label} ${index + 1}`}
                borderColor={error ? "red.500" : undefined}
                onChange={(event) =>
                  onChange(
                    patterns.map((candidate, position) =>
                      position === index ? event.target.value : candidate,
                    ),
                  )
                }
              />
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Remove ${removeLabel} ${index + 1}`}
                onClick={() => onChange(patterns.filter((_, position) => position !== index))}
              >
                <X size={14} />
              </Button>
            </HStack>
            {error && (
              <Text fontSize="xs" color="red.500">
                {error}
              </Text>
            )}
          </VStack>
        );
      })}
    </>
  );
}
