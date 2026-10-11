/**
 * The one surface. A fixed variant set, a fixed padding scale and optional header slots; no
 * style props, so a card cannot be restyled at the call site. With a `title` it is a section
 * card. Rulings: packages/design-system/adrs/002-overlay-and-card-shapes.md.
 */
import { Box, Card as ChakraCard, Grid, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * panel: on a page. nested: a well inside a card, drawer or dialog. frame: a border round an
 * editor, an image or a canvas, no fill. elevated: lifts off the page. showcase: hero figures,
 * the governance and gateway panels' look, used on purpose (ruling "Cards").
 */
export type CardVariant = "panel" | "nested" | "frame" | "elevated" | "showcase";

/** Where the card's subject stands: the dot before the title, always beside `badge` words. */
export type CardStatus = "ok" | "warning" | "bad" | "neutral";

export interface CardProps {
  /** Default "panel". */
  variant?: CardVariant;
  /** With a title it is a section card. */
  title?: ReactNode;
  /** h2 on a page (default), h3 inside a section. */
  titleLevel?: 2 | 3;
  /** One line under the title. */
  description?: ReactNode;
  /** 16px mark before the title. */
  icon?: ReactNode;
  status?: CardStatus;
  /** A StatusChip, a count. */
  badge?: ReactNode;
  /** Header right: xs buttons or the row-actions menu. */
  actions?: ReactNode;
  /** What the reader can do, under the body. */
  footer?: ReactNode;
  /**
   * md 16px, sm 12px; none: an embedded ListTable, a code block or an editor fills it. lg 20px
   * is the old Chakra card's own space, kept for a surface whose screenshots show it.
   */
  padding?: "lg" | "md" | "sm" | "none";
  /**
   * How the content slot lays its children out. flow (default): block flow. stack: a stretching
   * column with no gap. spaced: the same column with 12px between children.
   */
  bodyLayout?: BodyLayout;
  /** A card standing in for something not there yet: its border is dashed. */
  placeholder?: boolean;
  children?: ReactNode;
  "data-testid"?: string;
  /** The guided tour's spotlight target; lands on the painted outer root. */
  "data-tour"?: string;
}

export type BodyLayout = "flow" | "stack" | "spaced";

const BODY_GAP = { stack: 0, spaced: 3 } as const;

const RECIPE_VARIANT = {
  panel: "outline",
  nested: "subtle",
  frame: "outline",
  elevated: "elevated",
  showcase: "outline",
} as const;

/** frame keeps the panel's border and drops its fill, shadow and blur. */
const FRAME = { background: "transparent", boxShadow: "none", backdropFilter: "none" } as const;

/** The recipe's `showcase` look (Chakra's Card type lacks product variants): outline plus these. */
export const SHOWCASE = { borderRadius: "showcase", boxShadow: "showcase" } as const;

const OVERRIDES: Partial<Record<CardVariant, typeof FRAME | typeof SHOWCASE>> = {
  frame: FRAME,
  showcase: SHOWCASE,
};

const PADDING = { lg: 5, md: 4, sm: 3, none: 0 } as const;

const DOT_COLOR: Record<CardStatus, string> = {
  ok: "green.solid",
  warning: "orange.solid",
  bad: "red.solid",
  neutral: "fg.subtle",
};

/** A state before it is read; always beside a word saying the same thing. */
export function StatusDot({
  tone,
  "data-testid": testId,
}: {
  tone: CardStatus;
  "data-testid"?: string;
}) {
  return (
    <Box
      width="6px"
      height="6px"
      borderRadius="full"
      background={DOT_COLOR[tone]}
      flexShrink={0}
      aria-hidden="true"
      data-testid={testId}
    />
  );
}

export function Card({
  variant = "panel",
  title,
  titleLevel = 2,
  description,
  icon,
  status,
  badge,
  actions,
  footer,
  padding = "md",
  bodyLayout = "flow",
  placeholder = false,
  children,
  "data-testid": testId,
  "data-tour": tourId,
}: CardProps) {
  const hasHeader =
    title != null ||
    badge != null ||
    actions != null ||
    description != null ||
    icon != null ||
    status != null;
  const inset = PADDING[padding];
  return (
    <ChakraCard.Root
      variant={RECIPE_VARIANT[variant]}
      width="full"
      {...OVERRIDES[variant]}
      borderStyle={placeholder ? "dashed" : undefined}
      data-card-variant={variant}
      data-card-padding={padding}
      data-testid={testId}
      data-tour={tourId}
    >
      <ChakraCard.Body padding={0} gap={0}>
        {hasHeader && (
          <VStack
            align="stretch"
            gap={0.5}
            paddingX={inset || 4}
            paddingTop={inset || 3}
            paddingBottom={inset === 0 ? 3 : 2}
          >
            <HStack width="full" gap={2} align="center" minWidth={0}>
              {status && <StatusDot tone={status} />}
              {icon != null && (
                <Box color="fg.muted" display="flex" flexShrink={0}>
                  {icon}
                </Box>
              )}
              {title != null && (
                <Text as={titleLevel === 3 ? "h3" : "h2"} textStyle="cardTitle" minWidth={0}>
                  {title}
                </Text>
              )}
              <Spacer />
              {badge}
              {actions != null && (
                <HStack gap={1} flexShrink={0}>
                  {actions}
                </HStack>
              )}
            </HStack>
            {description != null && (
              <Text textStyle="caption" color="fg.muted">
                {description}
              </Text>
            )}
          </VStack>
        )}
        {children != null && (
          <Box
            paddingX={inset}
            paddingTop={hasHeader ? 0 : inset}
            paddingBottom={footer != null ? 0 : inset}
            flex={1}
            minWidth={0}
            {...(bodyLayout === "flow"
              ? {}
              : {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: BODY_GAP[bodyLayout],
                })}
          >
            {children}
          </Box>
        )}
        {footer != null && (
          <HStack
            gap={2}
            flexWrap="wrap"
            paddingX={inset || 4}
            paddingTop={2}
            paddingBottom={inset || 3}
          >
            {footer}
          </HStack>
        )}
      </ChakraCard.Body>
    </ChakraCard.Root>
  );
}

/** Equal-height cards in a responsive grid; the grid, never the card, decides width. */
export function CardGrid({
  columns = 3,
  children,
  "data-testid": testId,
}: {
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  "data-testid"?: string;
}) {
  const track = (count: number) => `repeat(${count}, minmax(0, 1fr))`;
  return (
    <Grid
      templateColumns={{
        base: track(1),
        md: track(Math.min(columns, 2)),
        lg: track(Math.min(columns, 3)),
        xl: track(columns),
      }}
      gap={4}
      alignItems="stretch"
      data-columns={columns}
      data-testid={testId}
    >
      {children}
    </Grid>
  );
}
