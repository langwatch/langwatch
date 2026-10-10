import { Alert, Box, Button } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import type { DailyCapAdvice } from "../logic/dailyCapAdvice";

/**
 * Advice — never a gate: the drafted condition would match more traces a day
 * than the plan's daily action ceiling allows. It is absent whenever the
 * estimate, the ceiling, or the relevance of either is in doubt, and saving is
 * untouched either way.
 *
 * Shared because the wizard renders it in two seats (ADR-093 §4): under the
 * match preview in the Watch step, where an edit already knows the saved
 * action class, and on the Review step at create, which is the first moment
 * every facet is known at once. Same words in both.
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
            About {advice.perDay.toLocaleString()} matches a day is over your
            plan&apos;s daily automation limit of {advice.cap.toLocaleString()}.
            Matches past the limit are skipped for the rest of the day. Narrow
            the condition so it selects fewer traces.
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
          <Link href="/settings/plans">Upgrade Plan</Link>
        </Button>
      </Alert.Root>
    </Box>
  );
}
