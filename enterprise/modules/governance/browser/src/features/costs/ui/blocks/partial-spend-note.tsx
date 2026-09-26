// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Text } from "@chakra-ui/react";

/**
 * The line under a chart whose bars are short, naming who left them short.
 *
 * Shared by the total chart and the provider split beside it: they are folded
 * from the same rows, so a period short in one is short in the other, and the
 * two panels have to say so in the same words. Renders nothing when no bar is
 * short, so the caller need not guard it.
 */
export function PartialSpendNote({
  providers,
}: {
  /** From `partialProviderNotes`: one phrase per short provider. */
  providers: readonly string[];
}) {
  if (providers.length === 0) return null;
  return (
    <Text fontSize="xs" color="fg.muted" aria-label="Some bars cover only part of what was spent">
      Part of {providers.join(", ")} spend has no dollar figure
    </Text>
  );
}
