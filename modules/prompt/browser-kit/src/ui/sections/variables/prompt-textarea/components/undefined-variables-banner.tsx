import { Button, HStack, Text } from "@chakra-ui/react";
import type { RefObject } from "react";

import type { Variable } from "../../variables-section.tsx";

/** Names the variables the prompt uses but never defines, with a one-click create. */
export function UndefinedVariablesBanner({
  bannerRef,
  invalidVariables,
  borderless,
  onCreateVariable,
}: {
  bannerRef: RefObject<HTMLDivElement | null>;
  invalidVariables: string[];
  borderless: boolean;
  onCreateVariable: ((variable: Variable) => void) | undefined;
}) {
  const [firstMissing] = invalidVariables;
  if (firstMissing === undefined) return null;
  return (
    <HStack
      ref={bannerRef}
      backgroundColor="red.subtle"
      borderRadius="lg"
      padding={1}
      marginBottom={1}
      paddingLeft={2}
      position="absolute"
      bottom={borderless ? -2 : 0}
      marginLeft={1}
      width="calc(100% - 8px)"
      justifyContent="space-between"
      gap={2}
      data-testid="undefined-variables-banner"
    >
      <Text fontSize="xs" color="red.fg">
        Undefined variables: {invalidVariables.join(", ")}
      </Text>
      {onCreateVariable && (
        <Button
          size="xs"
          height="20px"
          variant="surface"
          colorPalette="red"
          flexShrink={0}
          data-testid="create-missing-variable-button"
          onClick={() => onCreateVariable({ identifier: firstMissing, type: "str" })}
        >
          Create {`"${firstMissing}"`}
        </Button>
      )}
    </HStack>
  );
}
