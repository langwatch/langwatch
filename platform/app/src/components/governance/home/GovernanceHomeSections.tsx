import {
  Badge,
  Box,
  Button,
  Grid,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { Link } from "~/components/ui/link";

import type { SampleActivityRow, SampleInsight } from "./sampleHomeRows";
import {
  INSIGHTS_HREF,
  SAMPLE_ACTIVITY,
  SAMPLE_INSIGHTS,
  SEVERITIES,
} from "./sampleHomeRows";

/**
 * What sits under the governance hero: the two lists the overview will fill
 * once there is something to fill them with.
 *
 * The overview used to open with a wall of panels, each one reading a
 * different router, and a reader with none of it set up met a page of refusals
 * and zeroes. These two say what will appear here and offer the one way to
 * bring it forward; nothing here reads anything, so nothing here can fail.
 *
 * With sample mode on they carry invented rows instead of the empty lines, so
 * a reader who has not connected a source can still see the shape of what this
 * page becomes — not just its subject but its ANATOMY: an insight is a
 * severity, a headline and a date, and a recent item is a mark, a name and the
 * kind of thing it was. Both lists say `sample` beside their own label while
 * they do. There is no banner across the top of this page as there is on the
 * other five: the invented content here is two labelled lists a hand's width
 * from their own badges, and a strip above the greeting would be the loudest
 * thing on a page whose whole job is to take a question. The choice behind the
 * badge is the section's one shared answer — see
 * `~/components/governance/sample`.
 *
 * Insights leads because it is the read a governance admin comes back for;
 * recent activity is the shorter trail beside it, hence the wider left
 * column. On a narrow window they stack in that same order.
 *
 * The page sets the width. This grid fills whatever column it is given, so
 * that the two lists start and end on the ask field's own edges rather than
 * running out to the window.
 *
 * The rows themselves are next door in `./sampleHomeRows`, so that rewriting
 * the fiction never means opening the file that lays it out.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature,
 * specs/ai-governance/dashboard/governance-ui-controls.feature
 */

/** Wide enough for the longest of the three labels, so headlines line up. */
const SEVERITY_COLUMN = "104px";

export function GovernanceHomeSections({
  canSetUpInsights,
  sample,
}: {
  /**
   * Whether the Insights screen is offered to this organization. Without
   * it the button is not drawn: it would lead to a page the reader cannot
   * open. The same flag decides which sample rows are drawn, for the same
   * reason.
   */
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

/**
 * One insight: how it reads, what it says, when it was found.
 *
 * The headline is held to one line. An insight that wrapped would push the
 * rows out of step with each other and turn a list you scan into a list you
 * read, and the whole sentence is a click away on the Insights screen anyway.
 */
function InsightRow({ severity, headline, date }: SampleInsight) {
  const { label, palette } = SEVERITIES[severity];
  return (
    <RowFrame>
      {/* The badge sits in a column of its own width rather than taking its
          own: the three labels are three different lengths, and a badge that
          set the row's start would give the list three different left edges
          for the reader's eye to find. */}
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

/** One thing the reader went back to, and the kind of thing it was. */
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
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          {kind}
        </Text>
      </RowFrame>
    </Link>
  );
}

/**
 * The rows of one list, hairlined apart.
 *
 * Separators rather than cards: these are two lists on one page, and boxing
 * each row would make five objects out of what the reader should read as one
 * column. The last hairline is dropped so the list does not close with a rule
 * that has nothing under it.
 */
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
        /* The plain `border` token, not `border.subtle` or `border.muted`:
           measured in the browser, both of those resolve to the same slate the
           section's own ground is painted in, so a hairline drawn in either is
           a hairline nobody sees. */
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

/**
 * One titled list. The label is small, quiet and set wide — it names the
 * list without competing with the greeting above it — and the hairline
 * under it is where the rows start.
 */
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
