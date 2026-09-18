/**
 * The two lists under the hero. Nothing here reads anything, so nothing
 * here can fail; sample mode swaps in invented rows from
 * `../../model/sample-home-rows.ts`. Ported from `.../GovernanceHomeSections.tsx` (main).
 */
import { Badge, Box, Button, Grid, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { Link } from "../../../../ui/elements/governance-link.tsx";

import type { SampleActivityRow, SampleInsight } from "../../model/sample-home-rows.ts";
import {
  INSIGHTS_HREF,
  SAMPLE_ACTIVITY,
  SAMPLE_INSIGHTS,
  SEVERITIES,
} from "../../model/sample-home-rows.ts";

/** Wide enough for the longest of the three labels, so headlines line up. */
const SEVERITY_COLUMN = "104px";

export function GovernanceHomeSections({
  canSetUpInsights,
  sample,
}: {
  /** Whether Insights is offered; also filters which sample rows draw. */
  canSetUpInsights: boolean;
  /** Whether the two lists carry invented rows rather than empty lines. */
  sample: boolean;
}) {
  const activity = SAMPLE_ACTIVITY.filter(
    (row) => canSetUpInsights || !row.ridesInsightsFlag,
  );

  return (
    <Grid
      templateColumns={{ base: "1fr", lg: "2fr 1fr" }}
      gap={{ base: 8, lg: 10 }}
      width="full"
    >
      <HomeSection label="Insights" sample={sample}>
        {sample ? (
          <RowList>
            {SAMPLE_INSIGHTS.map((insight) => (
              <InsightRow key={insight.headline} {...insight} />
            ))}
          </RowList>
        ) : (
          <EmptyLine text="Nothing to report yet. Insights appear here once sources are pulling." />
        )}
        {canSetUpInsights && (
          <Box paddingTop={4}>
            <Button asChild size="sm" variant="outline">
              <Link href={INSIGHTS_HREF}>Set up insights</Link>
            </Button>
          </Box>
        )}
      </HomeSection>

      <HomeSection label="Recent activity" sample={sample}>
        {sample ? (
          <RowList>
            {activity.map((row) => (
              <ActivityRow key={row.name} {...row} />
            ))}
          </RowList>
        ) : (
          <EmptyLine text="Your recent screens will show up here." />
        )}
      </HomeSection>
    </Grid>
  );
}

/** One insight: severity, headline (one line, ellipsised), and date. */
function InsightRow({ severity, headline, date }: SampleInsight) {
  const { label, palette } = SEVERITIES[severity];
  return (
    <RowFrame>
      {/* Fixed-width column so the three differently-sized labels still
          give the list one left edge. */}
      <Box width={SEVERITY_COLUMN} flexShrink={0}>
        <Badge size="sm" variant="subtle" colorPalette={palette}>
          {label}
        </Badge>
      </Box>
      <Text
        fontSize="sm"
        color="fg"
        flex="1"
        minWidth={0}
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {headline}
      </Text>
      <Text fontSize="xs" color="fg.muted" flexShrink={0}>
        {date}
      </Text>
    </RowFrame>
  );
}

/**
 * One thing the reader went back to. `kind` is a chip (category, closed
 * set) in `surface` grey, not the `subtle` grey the header already uses for
 * "sample" — reusing that badge here would say the same thing twice.
 */
function ActivityRow({
  name,
  kind,
  href,
  icon: RowIcon,
}: Omit<SampleActivityRow, "ridesInsightsFlag">) {
  return (
    <Link href={href} _hover={{ textDecoration: "none" }}>
      <RowFrame>
        <Icon boxSize={3.5} color="fg.muted" flexShrink={0}>
          <RowIcon />
        </Icon>
        {/* minWidth:0 lets this shrink below its min-content so the fixed
            chip beside it never gets pushed out; overflow/ellipsis clip the
            shrunken text instead of letting it paint past its box. */}
        <Text
          fontSize="sm"
          color="fg"
          flex="1"
          minWidth={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {name}
        </Text>
        <Badge size="sm" variant="surface" colorPalette="gray">
          {kind}
        </Badge>
      </RowFrame>
    </Link>
  );
}

/** The rows of one list, hairlined apart rather than boxed as cards. */
function RowList({ children }: { children: React.ReactNode }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      /* The list bleeds a padding's width each side so that a row's hover
         fill and its hairline reach past the text, while the text itself
         still lines up under the section's own label. */
      marginX={-2}
      css={{
        /* The direct child, which is the row frame in one list and the link
           wrapping it in the other. Reaching a level deeper would put the
           hairline under an insight's severity badge instead of its row. */
        "& > *:not(:last-child)": {
          borderBottomWidth: "1px",
          borderColor: "border",
        },
      }}
    >
      {children}
    </VStack>
  );
}

/** The shape every row in either list shares: mark, name, and a right note. */
function RowFrame({ children }: { children: React.ReactNode }) {
  return (
    <HStack
      gap={3}
      align="center"
      width="full"
      paddingY={2.5}
      paddingX={2}
      transition="background 120ms"
      _hover={{ background: "bg.subtle" }}
    >
      {children}
    </HStack>
  );
}

/** One titled list: a small quiet label, then a hairline where rows start. */
function HomeSection({
  label,
  sample,
  children,
}: {
  label: string;
  sample: boolean;
  children: React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={0} minWidth={0}>
      <HStack gap={2} paddingBottom={2.5} align="center">
        <Text
          fontSize="11px"
          fontWeight="medium"
          letterSpacing="0.09em"
          textTransform="uppercase"
          color="fg.subtle"
        >
          {label}
        </Text>
        {/* Same word, size and grey as the mark on the cost lanes, so the
            reader learns it once for the whole section. */}
        {sample && (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            sample
          </Badge>
        )}
      </HStack>
      <Box borderTopWidth="1px" borderColor="border" paddingTop={2}>
        {children}
      </Box>
    </VStack>
  );
}

/** The line an empty list carries instead of rows. */
function EmptyLine({ text }: { text: string }) {
  return (
    <Text fontSize="sm" color="fg.muted" maxWidth="52ch" paddingTop={2}>
      {text}
    </Text>
  );
}
