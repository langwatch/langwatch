import { Box, chakra, Grid, HStack, Text } from "@chakra-ui/react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { prepareMailDocument, WIDTHS, type GalleryEntry } from "./studio-shared";

export type Density = "compact" | "comfortable";

const HtmlIframe = chakra("iframe");

const CARD_WIDTH: Record<Density, number> = { compact: 220, comfortable: 300 };
const CARD_PADDING: Record<Density, number> = { compact: 2, comfortable: 3.5 };
const MAX_PREVIEW = 480;
/** Ample room for the tallest transactional message; only its measured slice ever shows. */
const IFRAME_HEIGHT = 2400;

export interface GalleryViewProps {
  entries: GalleryEntry[] | null;
  failure: string | null;
  everyFixture: boolean;
  onEveryFixtureChange: (next: boolean) => void;
  width: keyof typeof WIDTHS;
  onWidthChange: (next: keyof typeof WIDTHS) => void;
  density: Density;
  onDensityChange: (next: Density) => void;
  previewDark: boolean;
  onOpen: (templateId: string, fixtureName: string) => void;
}

export const GalleryView = ({
  entries,
  failure,
  everyFixture,
  onEveryFixtureChange,
  width,
  onWidthChange,
  density,
  onDensityChange,
  previewDark,
  onOpen,
}: GalleryViewProps): JSX.Element => (
  <Box height="full" overflow="auto" bg="bg.muted">
    <HStack
      as="header"
      gap={4}
      paddingX={5}
      paddingY={3}
      borderBottomWidth="1px"
      borderColor="border"
      bg="bg.panel"
      position="sticky"
      top={0}
      zIndex={1}
      flexWrap="wrap"
    >
      <SegmentedControl
        size="xs"
        items={[
          { value: "first", label: "First fixture" },
          { value: "all", label: "Every fixture" },
        ]}
        value={everyFixture ? "all" : "first"}
        onValueChange={(details) => onEveryFixtureChange(details.value === "all")}
      />
      <SegmentedControl
        size="xs"
        items={["desktop", "mobile"]}
        value={width}
        onValueChange={(details) => onWidthChange(details.value as keyof typeof WIDTHS)}
      />
      <SegmentedControl
        size="xs"
        items={[
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
        ]}
        value={density}
        onValueChange={(details) => onDensityChange(details.value as Density)}
      />
      <Text fontSize="xs" color="fg.muted" marginLeft="auto">
        {entries?.length ?? 0} messages
      </Text>
    </HStack>

    {failure && (
      <Box padding={5} color="red.700" fontSize="sm">
        The gallery could not load: {failure}
      </Box>
    )}
    {!failure && !entries && (
      <Box padding={5} color="fg.muted" fontSize="sm">
        Rendering every message…
      </Box>
    )}

    {entries && (
      <Grid
        templateColumns={`repeat(auto-fill, minmax(${CARD_WIDTH[density]}px, 1fr))`}
        autoRows="max-content"
        gap={5}
        padding={5}
      >
        {entries.map((entry) => (
          <GalleryCard
            key={`${entry.template}:${entry.fixture}`}
            entry={entry}
            viewportWidth={WIDTHS[width]}
            density={density}
            previewDark={previewDark}
            onOpen={onOpen}
          />
        ))}
      </Grid>
    )}
  </Box>
);

/** The first non-transparent background a mail document actually paints. */
const readDocumentBackground = (doc: Document): string | null => {
  for (const el of [doc.body, doc.body.firstElementChild, doc.documentElement]) {
    if (!el) continue;
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
  }
  return null;
};

const GalleryCard = ({
  entry,
  viewportWidth,
  density,
  previewDark,
  onOpen,
}: {
  entry: GalleryEntry;
  viewportWidth: number;
  density: Density;
  previewDark: boolean;
  onOpen: (templateId: string, fixtureName: string) => void;
}): JSX.Element => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(CARD_WIDTH[density]);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [documentBg, setDocumentBg] = useState<string | null>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver((observed) => {
      const observedWidth = observed[0]?.contentRect.width;
      if (observedWidth) setCardWidth(observedWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const open = () => onOpen(entry.template, entry.fixture);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };
  const onIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = event.currentTarget.contentDocument;
    const body = doc?.body;
    if (body) setMeasuredHeight(body.scrollHeight);
    if (doc) setDocumentBg(readDocumentBackground(doc));
  };

  // Fills the card's exact width rather than a density-picked guess, so the
  // mail's own fixed-width layout never leaves a dead strip beside it.
  const scale = cardWidth / viewportWidth;
  const naturalHeight = measuredHeight ? measuredHeight * scale : null;
  const previewHeight = naturalHeight ? Math.min(naturalHeight, MAX_PREVIEW) : MAX_PREVIEW;
  const scrollable = naturalHeight != null && naturalHeight > MAX_PREVIEW;
  const fallbackBg = previewDark ? "#14161a" : "white";
  const html = prepareMailDocument(entry.html, previewDark);

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Open ${entry.title} — ${entry.fixture} in Inspect`}
      onClick={open}
      onKeyDown={onKeyDown}
      cursor="pointer"
      textAlign="left"
      display="flex"
      flexDirection="column"
      height="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="bg.panel"
      overflow="hidden"
      shadow="xs"
      transition="box-shadow 0.15s ease, border-color 0.15s ease"
      _hover={{ borderColor: "orange.300", shadow: "sm" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "orange.400", outlineOffset: "2px" }}
    >
      <Box
        flexShrink={0}
        paddingX={CARD_PADDING[density]}
        paddingTop={CARD_PADDING[density]}
        paddingBottom={2}
      >
        <Text
          fontFamily="mono"
          fontSize="2xs"
          color="fg.muted"
          letterSpacing="wide"
          truncate
          marginBottom={1}
        >
          {entry.template} · {entry.fixture}
        </Text>
        <Text fontSize="sm" fontWeight="semibold" lineClamp={2} lineHeight="short">
          {entry.subject}
        </Text>
      </Box>
      <Box
        ref={previewRef}
        flex="1"
        minHeight={0}
        overflow={scrollable ? "auto" : "hidden"}
        position="relative"
        bg={documentBg ?? fallbackBg}
        borderTopWidth="1px"
        borderColor="border"
      >
        <Box width="full" height={`${previewHeight}px`} position="relative" overflow="hidden">
          <HtmlIframe
            title={`${entry.title} — ${entry.fixture}`}
            srcDoc={html}
            onLoad={onIframeLoad}
            width={`${viewportWidth}px`}
            height={`${IFRAME_HEIGHT}px`}
            border="none"
            position="absolute"
            top={0}
            left={0}
            pointerEvents="none"
            transform={`scale(${scale})`}
            transformOrigin="top left"
          />
        </Box>
      </Box>
    </Box>
  );
};
