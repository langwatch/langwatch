/**
 * Where the progress bar was, once its run failed: why, what it cost, and Retry.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Box } from "@langwatch/design-system/primitives";

export function InstantEvalFailureBar({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Box position="absolute" top={0} left={0} right={0} zIndex={3} padding={2}>
      <Banner
        status="error"
        data-testid="instant-eval-failure"
        action={<BannerAction onClick={onRetry}>Retry</BannerAction>}
      >
        {message}
      </Banner>
    </Box>
  );
}
