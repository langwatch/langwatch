import { Alert } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Base warning surface shared by Dataset slug validation messages. */
export function SlugAlert({ children, ...props }: { children: ReactNode } & Alert.RootProps) {
  return (
    <Alert.Root status="warning" size="sm" {...props}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
