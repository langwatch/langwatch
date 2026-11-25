import { Alert, Button } from "@langwatch/design-system/primitives";
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
    <Alert.Root
      ref={bannerRef}
      status="error"
      size="sm"
      marginBottom={1}
      position="absolute"
      bottom={borderless ? -2 : 0}
      marginLeft={1}
      width="calc(100% - 8px)"
      data-testid="undefined-variables-banner"
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>Undefined variables: {invalidVariables.join(", ")}</Alert.Description>
      </Alert.Content>
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
    </Alert.Root>
  );
}
