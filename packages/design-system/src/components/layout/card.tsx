/**
 * The one surface. A fixed variant set, a fixed padding scale and optional header slots; no
 * style props, so a card cannot be restyled at the call site. With a `title` it is a section
 * card. Rulings: packages/design-system/adrs/002-overlay-and-card-shapes.md.
 */
import { Box, Card as ChakraCard, Grid, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";

import { type ProductAccent, useProductAccent } from "../scope/use-product-accent.ts";

/**
 * panel: on a page. nested: a well inside a card, drawer or dialog. frame: a border round an
 * editor, an image or a canvas, no fill. frame-fill: that frame filling its parent's room, the
 * editor scrolling inside. elevated: lifts off the page. showcase: hero figures (ruling "Cards").
 */
export type CardVariant = "panel" | "nested" | "frame" | "frame-fill" | "elevated" | "showcase";

/** Where the card's subject stands: the dot before the title, always beside `badge` words. */
export type CardStatus = "ok" | "warning" | "bad" | "neutral";

interface CardBaseProps {
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
  /**
   * md 16px, sm 12px; none: an embedded ListTable, a code block or an editor fills it. lg 20px
   * is the old Chakra card's own space, kept for a surface whose screenshots show it. Default md;
   * frame-fill has none.
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

interface OpenerProps {
  "aria-label"?: string;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
}

/** A card that is only a surface: header slots, footer, any controls inside. */
interface PlainCardProps {
  opener?: undefined;
  /** Header right: xs buttons or the row-actions menu. */
  actions?: ReactNode;
  /** What the reader can do, under the body. */
  footer?: ReactNode;
}

/** A card that opens something: its children are only presentation, so no controls inside. */
interface LinkedCardProps {
  /**
   * The native `<a>` or `<button>` that opens it, or a link component that renders one. It is
   * the card's one focus target, named by its own label, its text or a string `title`; a bare
   * `<button>` is given `type="button"`; any other native element is refused.
   */
  opener: ReactElement<OpenerProps>;
  actions?: never;
  footer?: never;
}

export type CardProps = CardBaseProps & (PlainCardProps | LinkedCardProps);

export type BodyLayout = "flow" | "stack" | "spaced";

const BODY_GAP = { stack: 0, spaced: 3 } as const;

const RECIPE_VARIANT = {
  panel: "outline",
  nested: "subtle",
  frame: "outline",
  "frame-fill": "outline",
  elevated: "elevated",
  showcase: "outline",
} as const;

/** frame keeps the panel's border and drops its fill, shadow and blur. */
const FRAME = { background: "transparent", boxShadow: "none", backdropFilter: "none" } as const;

/** frame-fill: the frame, filling a bounded parent; the editor inside owns the scrolling. */
const FRAME_FILL = {
  ...FRAME,
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "md",
} as const;

/** The recipe's `showcase` look (Chakra's Card type lacks product variants): outline plus these. */
export const SHOWCASE = { borderRadius: "showcase", boxShadow: "showcase" } as const;

const OVERRIDES: Partial<Record<CardVariant, typeof FRAME | typeof FRAME_FILL | typeof SHOWCASE>> =
  {
    frame: FRAME,
    "frame-fill": FRAME_FILL,
    showcase: SHOWCASE,
  };

/** What a frame-fill card adds to its body, content and bands so a bounded parent can size it. */
const FILLS = {
  body: { minWidth: 0, minHeight: 0 },
  content: { minHeight: 0 },
  band: { flexShrink: 0 },
} as const;
const NO_FILLS = { body: {}, content: {}, band: {} } as const;

const OPENER_CSS = {
  "& > [data-card-opener] > a, & > [data-card-opener] > button": {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    borderRadius: "xl",
    cursor: "pointer",
  },
} as const;

const PADDING = { lg: 5, md: 4, sm: 3, none: 0 } as const;

const DOT_COLOR: Record<CardStatus, string> = {
  ok: "green.solid",
  warning: "orange.solid",
  bad: "red.solid",
  neutral: "fg.subtle",
};

const hasContent = (node: ReactNode) =>
  typeof node === "string" ? node.trim() !== "" : node != null && node !== false;

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

/** The link-tile paint a card takes when it has an opener. */
function openerPaint({ accent }: { accent: ProductAccent }) {
  return {
    borderColor: "border",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    _hover: { borderColor: accent.roles.emphasized, boxShadow: "sm" },
    css: {
      ...OPENER_CSS,
      "& > [data-card-opener] > :focus-visible": {
        outline: "2px solid",
        outlineColor: accent.roles.focusRing,
        outlineOffset: "-2px",
      },
      "@media (prefers-reduced-motion: reduce)": { transition: "none" },
    },
  } as const;
}

/** The caller's native link or button, named and made a button that never submits. */
function OpenerLayer({ opener, title }: { opener: ReactElement<OpenerProps>; title: ReactNode }) {
  const native = opener.type;
  if (typeof native === "string" && native !== "a" && native !== "button") {
    throw new Error(`Card: the opener must be a link or a button, not <${native}>`);
  }
  const label = opener.props["aria-label"] ?? (typeof title === "string" ? title : void 0);
  if (label === void 0 && !hasContent(opener.props.children)) {
    throw new Error("Card: an opener needs a name: an aria-label, its text or a string title");
  }
  return (
    <Box display="contents" data-card-opener="">
      {cloneElement(opener, {
        "aria-label": label,
        type: native === "button" ? (opener.props.type ?? "button") : opener.props.type,
      })}
    </Box>
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
  opener,
  padding: paddingProp,
  bodyLayout = "flow",
  placeholder = false,
  children,
  "data-testid": testId,
  "data-tour": tourId,
}: CardProps) {
  const accent = useProductAccent();
  const fills = variant === "frame-fill";
  const fit = fills ? FILLS : NO_FILLS;
  const padding = paddingProp ?? (fills ? "none" : "md");
  const hasHeader =
    title != null ||
    badge != null ||
    actions != null ||
    description != null ||
    icon != null ||
    status != null;
  const inset = PADDING[padding];
  const layout = fills && bodyLayout === "flow" ? "stack" : bodyLayout;
  return (
    <ChakraCard.Root
      variant={RECIPE_VARIANT[variant]}
      width="full"
      {...OVERRIDES[variant]}
      {...(opener ? openerPaint({ accent }) : {})}
      borderStyle={placeholder ? "dashed" : undefined}
      data-card-variant={variant}
      data-card-padding={padding}
      data-testid={testId}
      data-tour={tourId}
    >
      {opener && <OpenerLayer opener={opener} title={title} />}
      <ChakraCard.Body padding={0} gap={0} {...fit.body}>
        {hasHeader && (
          <VStack
            align="stretch"
            gap={0.5}
            {...fit.band}
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
            {...fit.content}
            {...(layout === "flow"
              ? {}
              : {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: BODY_GAP[layout],
                })}
          >
            {children}
          </Box>
        )}
        {footer != null && (
          <HStack
            gap={2}
            flexWrap="wrap"
            {...fit.band}
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
