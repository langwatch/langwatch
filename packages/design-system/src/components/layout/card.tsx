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
export type CardVariant =
  | "panel"
  | "nested"
  | "frame"
  | "frame-fill"
  | "elevated"
  | "showcase"
  | "emphasized"
  | "accent-row"
  | "joined-panel"
  | "panel-fill"
  | "image-frame"
  | "banded";

/** The fixed palette roles of a `banded` card's title band. */
export type CardBandTone = "blue" | "purple" | "teal" | "amber" | "pink" | "gray";

/** The palette roles a nested card or an accent row may carry; omitted, nothing is coloured. */
export type CardTone = "neutral" | "teal" | "blue" | "yellow" | "red" | "purple" | "green";

/**
 * Tone belongs to `nested` (a tinted well: border, fill and heading) and `accent-row` (only the
 * left edge); any other variant takes none.
 */
type NoExtras = { invalid?: never; edge?: never; borderTone?: never; bandTone?: never };

/**
 * `invalid` belongs to `frame` (the whole border turns red). `joined-panel` needs its `edge`.
 * `borderTone` belongs to a neutral `nested` well; a tone already colours its border.
 */
type ToneProps =
  | (NoExtras & { variant: "nested" | "accent-row"; tone?: CardTone })
  | (NoExtras & { variant?: Exclude<CardVariant, "joined-panel" | "banded">; tone?: never })
  | (Omit<NoExtras, "bandTone"> & { variant: "banded"; tone?: never; bandTone: CardBandTone })
  | (Omit<NoExtras, "invalid"> & { variant: "frame"; tone?: never; invalid?: boolean })
  | (Omit<NoExtras, "borderTone"> & {
      variant: "nested";
      tone?: "neutral";
      borderTone: "default" | "muted";
    })
  | (Omit<NoExtras, "edge"> & { variant: "joined-panel"; tone?: never; edge: "start" | "end" });

/** Where the card's subject stands: the dot before the title, always beside `badge` words. */
export type CardStatus = "ok" | "warning" | "bad" | "neutral";

interface CardBaseProps {
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
   * md 16px, sm 12px, xs 8px; none: a ListTable, code block or editor fills it. lg 20px is the old
   * Chakra card's space. xl 24px all round; inline-lg 24px across, 20px down. Default md;
   * frame-fill none; accent-row 8px.
   */
  padding?: "xl" | "inline-lg" | "lg" | "md" | "sm" | "xs" | "none";
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

export type CardProps = CardBaseProps & ToneProps & (PlainCardProps | LinkedCardProps);

export type BodyLayout = "flow" | "stack" | "spaced";

const BODY_GAP = { stack: 0, spaced: 3 } as const;

const RECIPE_VARIANT = {
  panel: "outline",
  nested: "subtle",
  frame: "outline",
  "frame-fill": "outline",
  elevated: "elevated",
  showcase: "outline",
  emphasized: "outline",
  "accent-row": "subtle",
  "joined-panel": "outline",
  "panel-fill": "outline",
  "image-frame": "outline",
  banded: "outline",
} as const;

/** frame keeps the panel's border and drops its fill, shadow and blur. */
const FRAME = { background: "transparent", boxShadow: "none", backdropFilter: "none" } as const;

/** panel-fill: the panel (border, radius, shadow, ground) filling a bounded parent. */
const PANEL_FILL = {
  display: "flex",
  flexDirection: "column",
  height: "full",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
} as const;

/** image-frame: a bounded presentation frame round an image, letterboxed on the subtle ground. */
const IMAGE_FRAME = {
  boxShadow: "none",
  backdropFilter: "none",
  background: "bg.subtle",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "lg",
  overflow: "hidden",
} as const;

/** banded: an informational group with a toned title band; hover colours the edge only. */
function bandedPaint({ bandTone }: { bandTone: CardBandTone }) {
  return {
    background: "bg.panel",
    borderRadius: "md",
    borderWidth: "1px",
    borderColor: "border.muted",
    overflow: "hidden",
    boxShadow: "none",
    backdropFilter: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    _hover: { borderColor: `${bandTone}.muted`, boxShadow: "sm" },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  } as const;
}

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

/** emphasized: a panel with an explicit edge and opaque ground; keeps the outline shadow. */
const EMPHASIZED = {
  borderColor: "border.emphasized",
  background: "bg.panel",
  borderRadius: "2xl",
} as const;

/** accent-row: a compact editable row; the tone colours only the left edge. */
const ACCENT_ROW = {
  background: "bg.subtle",
  borderColor: "border",
  borderRadius: "md",
  boxShadow: "none",
  backdropFilter: "none",
} as const;

/** One half of a pair: studio paint, 8px outer corners, no border on the joining side. */
function joinedPaint({ edge }: { edge: "start" | "end" }) {
  return {
    background: "bg",
    borderColor: "border.emphasized",
    boxShadow: "sm",
    backdropFilter: "none",
    ...(edge === "start"
      ? { borderRadius: 0, borderStartRadius: "lg", borderEndWidth: 0 }
      : { borderRadius: 0, borderEndRadius: "lg", borderStartWidth: 0 }),
    display: "flex",
    flexDirection: "column",
    height: "full",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  } as const;
}

const OVERRIDES: Partial<
  Record<
    CardVariant,
    | typeof PANEL_FILL
    | typeof IMAGE_FRAME
    | typeof FRAME
    | typeof FRAME_FILL
    | typeof SHOWCASE
    | typeof EMPHASIZED
    | typeof ACCENT_ROW
  >
> = {
  frame: FRAME,
  "panel-fill": PANEL_FILL,
  "image-frame": IMAGE_FRAME,
  "frame-fill": FRAME_FILL,
  showcase: SHOWCASE,
  emphasized: EMPHASIZED,
  "accent-row": ACCENT_ROW,
};

const NO_LIFT = { boxShadow: "none", backdropFilter: "none" } as const;

/** A nested card's tinted well; neutral is an inset in the border and subtle fill. */
function wellPaint({ tone }: { tone: CardTone }) {
  if (tone === "neutral") {
    return {
      ...NO_LIFT,
      borderColor: "border",
      background: "bg.subtle",
      borderRadius: "md",
    } as const;
  }
  return {
    ...NO_LIFT,
    borderColor: `${tone}.muted`,
    background: `${tone}.subtle`,
    borderRadius: "lg",
  } as const;
}

/** The 2px left edge of an accent row. */
function edgePaint({ tone }: { tone: CardTone }) {
  return {
    borderLeftWidth: "2px",
    borderLeftColor: `${tone === "neutral" ? "gray" : tone}.fg`,
  } as const;
}

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

/** Spacing steps across (x) and down (y). */
const INSET = {
  xl: { x: 6, y: 6 },
  "inline-lg": { x: 6, y: 5 },
  lg: { x: 5, y: 5 },
  md: { x: 4, y: 4 },
  sm: { x: 3, y: 3 },
  xs: { x: 2, y: 2 },
  none: { x: 0, y: 0 },
} as const;

/** An accent row's own 8px, when no padding is named. */
const ROW_INSET = { x: 2, y: 2 } as const;

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

type HeaderParts = Pick<CardBaseProps, "title" | "status" | "icon" | "badge" | "description"> & {
  actions?: ReactNode;
};

/** The header band: dot, icon, title, badge and actions on one row, the description under it. */
function CardHeader({
  inset,
  band,
  headTone,
  titleLevel,
  parts: { title, status, icon, badge, actions, description },
}: {
  inset: { x: number; y: number };
  band: typeof FILLS.band | typeof NO_FILLS.band;
  headTone: string | undefined;
  titleLevel: 2 | 3;
  parts: HeaderParts;
}) {
  return (
    <VStack
      align="stretch"
      gap={0.5}
      {...band}
      paddingX={inset.x || 4}
      paddingTop={inset.y || 3}
      paddingBottom={inset.y === 0 ? 3 : 2}
    >
      <HStack width="full" gap={2} align="center" minWidth={0}>
        {status && <StatusDot tone={status} />}
        {icon != null && (
          <Box color={headTone ?? "fg.muted"} display="flex" flexShrink={0}>
            {icon}
          </Box>
        )}
        {title != null && (
          <Text
            as={titleLevel === 3 ? "h3" : "h2"}
            textStyle="cardTitle"
            color={headTone}
            minWidth={0}
          >
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
  );
}

/** The banded card's title band: 12px across, 8px down, small uppercase title, a muted rule. */
function BandHeader({
  bandTone,
  titleLevel,
  title,
  icon,
}: {
  bandTone: CardBandTone;
  titleLevel: 2 | 3;
  title: ReactNode;
  icon: ReactNode;
}) {
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      flexShrink={0}
      background={`${bandTone}.subtle`}
      color={`${bandTone}.fg`}
      borderBottomWidth="1px"
      borderColor="border.muted"
      data-card-band=""
    >
      {icon != null && (
        <Box display="flex" flexShrink={0}>
          {icon}
        </Box>
      )}
      <Text
        as={titleLevel === 3 ? "h3" : "h2"}
        fontSize="2xs"
        fontWeight="semibold"
        textTransform="uppercase"
        letterSpacing="0.06em"
        minWidth={0}
      >
        {title}
      </Text>
    </HStack>
  );
}

/** The surface a variant, its tone and an opener paint, merged in the order that wins. */
function surfacePaint({
  variant,
  tone,
  opener,
  accent,
  edge,
  invalid,
  borderTone,
  bandTone,
}: {
  bandTone?: CardBandTone;
  variant: CardVariant;
  tone: CardTone | undefined;
  opener: boolean;
  accent: ProductAccent;
  edge?: "start" | "end";
  invalid?: boolean;
  borderTone?: "default" | "muted";
}) {
  return {
    ...OVERRIDES[variant],
    ...(variant === "joined-panel" && edge ? joinedPaint({ edge }) : {}),
    ...(variant === "frame" && invalid ? { borderColor: "border.error" } : {}),
    ...(variant === "nested" && tone !== undefined ? wellPaint({ tone }) : {}),
    ...(variant === "nested" && borderTone === "muted" && (tone === undefined || tone === "neutral")
      ? { borderColor: "border.muted" }
      : {}),
    ...(variant === "banded" && bandTone ? bandedPaint({ bandTone }) : {}),
    ...(variant === "accent-row" ? edgePaint({ tone: tone ?? "neutral" }) : {}),
    ...(opener ? openerPaint({ accent }) : {}),
  };
}

/** A joined panel has 24px, a frame-fill none (its content fills it), the rest 16px. */
function defaultPadding({
  variant,
  joined,
  fills,
}: {
  variant: CardVariant;
  joined: boolean;
  fills: boolean;
}) {
  if (variant === "banded") return "sm";
  if (joined) return "xl";
  return fills || variant === "image-frame" ? "none" : "md";
}

function refuseUnsupportedShape({
  variant,
  tone,
  opener,
  title,
  actions,
  footer,
}: {
  variant: CardVariant;
  tone?: string;
  opener?: unknown;
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const presentation = variant === "banded" || variant === "image-frame";
  if (opener && (variant === "accent-row" || tone !== undefined || presentation)) {
    throw new Error(
      "Card: an accent row, a toned or banded card or an image frame is not an opener",
    );
  }
  if (variant === "image-frame" && (title != null || actions != null || footer != null)) {
    throw new Error("Card: an image frame holds only its image, with no header or footer");
  }
}

export function Card({
  variant = "panel",
  tone,
  invalid,
  edge,
  borderTone,
  bandTone,
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
  const joined = variant === "joined-panel";
  const fills = variant === "frame-fill" || variant === "panel-fill" || joined;
  const fit = fills ? FILLS : NO_FILLS;
  const rowDefault = variant === "accent-row" && paddingProp === undefined;
  const padding = paddingProp ?? defaultPadding({ variant, joined, fills });
  refuseUnsupportedShape({ variant, tone, opener, title, actions, footer });
  const hasHeader =
    title != null ||
    badge != null ||
    actions != null ||
    description != null ||
    icon != null ||
    status != null;
  const { x: insetX, y: insetY } = rowDefault ? ROW_INSET : INSET[padding];
  const headTone = tone !== undefined && tone !== "neutral" ? `${tone}.fg` : undefined;
  const layout = fills && bodyLayout === "flow" ? "stack" : bodyLayout;
  return (
    <ChakraCard.Root
      variant={RECIPE_VARIANT[variant]}
      width="full"
      {...surfacePaint({
        variant,
        tone,
        opener: opener !== undefined,
        accent,
        edge,
        invalid,
        borderTone,
        bandTone,
      })}
      borderStyle={placeholder ? "dashed" : undefined}
      data-card-variant={variant}
      data-card-padding={rowDefault ? "row" : padding}
      data-card-tone={tone}
      data-card-invalid={invalid ? "" : undefined}
      data-card-edge={edge}
      data-card-border-tone={borderTone}
      data-card-band-tone={bandTone}
      data-testid={testId}
      data-tour={tourId}
    >
      {opener && <OpenerLayer opener={opener} title={title} />}
      <ChakraCard.Body padding={0} gap={0} {...fit.body}>
        {hasHeader && variant === "banded" && bandTone && (
          <BandHeader bandTone={bandTone} titleLevel={titleLevel} title={title} icon={icon} />
        )}
        {hasHeader && variant !== "banded" && (
          <CardHeader
            inset={{ x: insetX, y: insetY }}
            band={fit.band}
            headTone={headTone}
            titleLevel={titleLevel}
            parts={{ title, status, icon, badge, actions, description }}
          />
        )}
        {children != null && (
          <Box
            paddingX={insetX}
            paddingTop={hasHeader ? 0 : insetY}
            paddingBottom={footer != null ? 0 : insetY}
            flex={1}
            minWidth={0}
            {...fit.content}
            {...(joined ? { overflowY: "auto" } : {})}
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
            paddingX={insetX || 4}
            paddingTop={2}
            paddingBottom={insetY || 3}
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
