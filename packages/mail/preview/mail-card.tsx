import { Panel, Text } from "@langwatch/design-system-internal";
import { useEffect, useRef, useState, type JSX, type SyntheticEvent } from "react";

import { prepareMailDocument, type RenderedFixture } from "./studio-shared.ts";

/** Until the card is measured; the review grid's columns start near this. */
const INITIAL_CARD_WIDTH = 360;
const MAX_PREVIEW = 480;
/** Ample room for the tallest message; only its measured slice ever shows. */
const IFRAME_HEIGHT = 2400;

/** The first non-transparent background a mail document actually paints. */
const readDocumentBackground = (doc: Document): string | null => {
  for (const el of [doc.body, doc.body.firstElementChild, doc.documentElement]) {
    if (!el) continue;
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
  }
  return null;
};

/** One rendered email, scaled down to fill its card's width. */
export const MailCard = ({
  entry,
  viewportWidth,
  previewDark,
}: {
  entry: RenderedFixture;
  viewportWidth: number;
  previewDark: boolean;
}): JSX.Element => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(INITIAL_CARD_WIDTH);
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

  const onIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = event.currentTarget.contentDocument;
    const body = doc?.body;
    if (body) setMeasuredHeight(body.scrollHeight);
    if (doc) setDocumentBg(readDocumentBackground(doc));
  };

  // Fills the card's exact width, so the mail's own fixed-width layout never leaves a dead strip.
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
