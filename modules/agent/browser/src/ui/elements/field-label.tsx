import { HStack } from "@langwatch/design-system/primitives";

/** One label above a field, drawn as the Agent Testing dialogs draw theirs. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <HStack
      as="span"
      gap={1.5}
      marginBottom={1}
      fontSize="11.5px"
      fontWeight="medium"
      color="fg.muted"
    >
      {children}
    </HStack>
  );
}
