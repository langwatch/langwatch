import {
  Callout,
  IconArrowUpRight,
  IconButton,
  Inline,
  Page,
  Panel,
  SegmentedControl,
  Text,
} from "@langwatch/design-system-internal";
import { useEffect, useRef, useState, type JSX, type ReactNode, type SyntheticEvent } from "react";

import { WIDTH_OPTIONS } from "./inspect-view.tsx";
import { prepareMailDocument, WIDTHS, type GalleryEntry } from "./studio-shared.ts";

export type Density = "compact" | "comfortable";

const CARD_WIDTH: Record<Density, number> = { compact: 220, comfortable: 300 };
const MAX_PREVIEW = 480;
/** Ample room for the tallest transactional message; only its measured slice ever shows. */
const IFRAME_HEIGHT = 2400;

const FIXTURE_OPTIONS: { value: "first" | "all"; label: string }[] = [
  { value: "first", label: "First fixture" },
  { value: "all", label: "Every fixture" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

export interface GalleryViewProps {
  nav: ReactNode;
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
  nav,
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
  <Page
    nav={nav}
    width="full"
    title="Gallery"
    subtitle={`${entries?.length ?? 0} messages`}
    actions={
      <Inline gap={2} wrap justify="end">
        <SegmentedControl
          label="Fixtures"
          size="sm"
          options={FIXTURE_OPTIONS}
          value={everyFixture ? "all" : "first"}
          onChange={(next) => onEveryFixtureChange(next === "all")}
        />
        <SegmentedControl
          label="Width"
          size="sm"
          options={WIDTH_OPTIONS}
          value={width}
          onChange={onWidthChange}
        />
        <SegmentedControl
          label="Density"
          size="sm"
          options={DENSITY_OPTIONS}
          value={density}
          onChange={onDensityChange}
        />
      </Inline>
    }
  >
    {failure && (
      <Callout tone="error" title="The gallery could not load">
        {failure}
      </Callout>
    )}
    {!failure && !entries && <Text tone="secondary">Rendering every message…</Text>}
    {entries && (
      <div className="mailroom-gallery" data-density={density}>
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
      </div>
    )}
  </Page>
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
  const html = prepareMailDocument(entry.html, previewDark);

  return (
    <Panel
      flush
      title={
        <Text truncate title={`Subject: ${entry.subject}`}>
          {entry.title}
        </Text>
      }
      meta={entry.fixture}
      actions={
        <IconButton
          label={`Open ${entry.title}, ${entry.fixture}, in Inspect`}
          icon={<IconArrowUpRight />}
          size="sm"
          onClick={open}
        />
      }
    >
      <div
        ref={previewRef}
        className="mailroom-card-preview"
        data-scrollable={scrollable ? "" : undefined}
        style={documentBg ? { background: documentBg } : undefined}
      >
        <div className="mailroom-card-window" style={{ height: previewHeight }}>
          <iframe
            title={`${entry.title}, ${entry.fixture}`}
            srcDoc={html}
            onLoad={onIframeLoad}
            style={{ width: viewportWidth, height: IFRAME_HEIGHT, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </Panel>
  );
};
