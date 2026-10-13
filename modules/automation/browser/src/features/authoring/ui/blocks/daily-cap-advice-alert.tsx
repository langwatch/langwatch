import { Link } from "@langwatch/browser-host/link";
import { Alert, Box, Button } from "@langwatch/design-system/primitives";

import type { DailyCapAdvice } from "../../model/daily-cap-advice.ts";

/**
 * Advice, never a gate: the drafted condition would match more traces a day
 * than the plan's daily ceiling allows. Rendered in two seats (ADR-093 §4):
 * under the Watch step's match preview, and on the Review step at create.
 */
export function DailyCapAdviceAlert({
  advice,
  hasDividerBelow = false,
}: {
  advice: DailyCapAdvice | null;
  /** Set when this sits inside the preview panel with rows under it. */
  hasDividerBelow?: boolean;
}) {
  if (!advice) return null;
  return (
    <Box
      paddingX={3}
      paddingY={2}
      borderBottomWidth={hasDividerBelow ? "1px" : "0"}
      borderColor="border"
    >
      <Alert.Root
        status="warning"
        size="sm"
        variant="subtle"
        width="full"
        data-testid="daily-cap-advice"
      >
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description textStyle="xs">
            About {advice.perDay.toLocaleString()} matches a day is over your plan&apos;s daily
            automation limit of {advice.cap.toLocaleString()}. Matches past the limit are skipped
            for the rest of the day. Narrow the condition so it selects fewer traces.
          </Alert.Description>
        </Alert.Content>
        <Button
          asChild
          size="xs"
          variant="outline"
          bg="bg"
          flexShrink={0}
          alignSelf="center"
          data-testid="daily-cap-advice-upgrade"
        >
          <Link unstyled href="/settings/plans">
            Upgrade Plan
          </Link>
        </Button>
      </Alert.Root>
    </Box>
  );
}
