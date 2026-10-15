/** The actions peers lend the row under a settled answer (§10.1); nothing draws without one. */

import { IsolatedErrorBoundary } from "@langwatch/browser-host/isolated-error-boundary";
import { useLentAll } from "@langwatch/browser-host/lent";
import { HStack } from "@langwatch/design-system/primitives";
import { LangyAnswerActionToken, type LangyAnswerActionProps } from "@langwatch/langy-contract";
import { Suspense } from "react";

export function LentAnswerActions(props: LangyAnswerActionProps) {
  const actions = useLentAll(LangyAnswerActionToken);
  if (actions.length === 0) return null;
  return (
    <HStack data-testid="langy-answer-actions" gap={1} paddingX="2px">
      {actions.map(({ owner, Component }) => (
        <IsolatedErrorBoundary key={owner} scope="This action failed to load">
          <Suspense fallback={null}>
            <Component {...props} />
          </Suspense>
        </IsolatedErrorBoundary>
      ))}
    </HStack>
  );
}
