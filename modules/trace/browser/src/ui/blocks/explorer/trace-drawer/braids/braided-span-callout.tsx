import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Box, Text } from "@langwatch/design-system/primitives";
import type { SpanBraid } from "@langwatch/trace-contract";
import { Fragment } from "react";

/**
 * Says why a span from another project shows in this trace. "Open in" is
 * offered only to someone who can open the owner, and only with a place to go.
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
              <a href={ownerHref}>Open in {braid.ownerName}</a>
            </BannerAction>
          ) : undefined
        }
        data-testid="braided-span-callout"
      >
        <Text as="span" textStyle="sm">
          <ShownBecause braid={braid} />
          {braid.signedBy ? ` Signed by ${braid.signedBy.name}.` : null}
        </Text>
      </Banner>
    </Box>
  );
}

function ShownBecause({ braid }: { braid: SpanBraid }) {
  if (braid.matchedConditions.length === 0) {
    return <>Shown because a braid shares every span of {braid.ownerName} in this trace.</>;
  }
  return (
    <>
      Shown because it matches{" "}
      {braid.matchedConditions.map((condition, index) => (
        <Fragment key={condition}>
          {index > 0 ? " or " : null}
          <InlineCode>{condition}</InlineCode>
        </Fragment>
      ))}
      .
    </>
  );
}
