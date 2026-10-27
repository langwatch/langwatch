// A read that failed, said in place rather than as an empty section.

import { Alert } from "@langwatch/design-system/primitives";

export function SectionErrorNotice({ title }: { title: string }) {
  return (
    <Alert.Root status="error" data-testid="section-error-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
      </Alert.Content>
    </Alert.Root>
  );
}
