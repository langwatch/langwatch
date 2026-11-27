import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { HighlightedExpression } from "@langwatch/design-system/highlighted-expression";
import { Box, Stack, Text } from "@langwatch/design-system/primitives";
import type { SpanBraid } from "@langwatch/trace-contract";

/**
 * Says why a span from another project shows in this trace. "Open in" is offered only to someone
 * who can open the owner, and only with a place to go; each condition stands on its own line.
 */
export function BraidedSpanCallout({
  braid,
  ownerHref,
}: {
  braid: SpanBraid;
  ownerHref: string | null;
}) {
  const canOpen = braid.canOpenOwner && ownerHref !== null;
  return (
    <Box paddingX={4} paddingTop={3}>
      <Banner
        status="info"
        placement="inline"
        icon={<FeatureMark feature="braids" size={18} />}
        title={`Braided from ${braid.ownerName}`}
        action={
          canOpen ? (
            <BannerAction asChild>
              <Link href={ownerHref}>Open in {braid.ownerName}</Link>
            </BannerAction>
          ) : undefined
        }
        data-testid="braided-span-callout"
      >
        <Stack gap={1.5}>
          <ShownBecause braid={braid} />
          <Text textStyle="sm">
            {braid.signedBy ? `Signed by ${braid.signedBy.name}. ` : null}
            {`Evaluations from ${braid.ownerName} stay in that project.`}
          </Text>
        </Stack>
      </Banner>
    </Box>
  );
}

function ShownBecause({ braid }: { braid: SpanBraid }) {
  if (braid.matchedConditions.length === 0) {
    return (
      <Text textStyle="sm">
        Shown because a braid shares every span of {braid.ownerName} in this trace.
      </Text>
    );
  }
  const one = braid.matchedConditions.length === 1;
  return (
    <Stack gap={1} data-testid="braided-span-conditions">
      <Text textStyle="sm">
        {one ? "Shown because it matches:" : "Shown because it matches one of:"}
      </Text>
      {braid.matchedConditions.map((condition) => (
        <HighlightedExpression key={condition} layout="block" code={condition} />
      ))}
    </Stack>
  );
}
