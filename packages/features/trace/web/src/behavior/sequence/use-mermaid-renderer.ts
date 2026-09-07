import { type Dispatch, type RefObject, type SetStateAction, useEffect, useState } from "react";
import type { MermaidConfig } from "mermaid";
import { EASTER_EGG_IMAGE_URL } from "../use-konami-easter-egg.ts";

// Mermaid is loaded via a true `await import()` inside the effect so it stays in its
// own chunk.

const MINIMAP_W = 200;
const MINIMAP_H = 72;

interface SvgSize {
  width: number;
  height: number;
}

export interface MermaidRenderResult {
  syntax: string;
  idToSpanId: Map<string, string>;
  idDisplay: Map<string, string>;
  idKind: Map<string, string>;
  primaryCount: number;
}

interface UseMermaidRendererArgs {
  result: MermaidRenderResult;
  colorMode: "light" | "dark";
  easterEgg: boolean;
  onSelectSpan: (spanId: string) => void;
  stageRef: RefObject<HTMLDivElement | null>;
  minimapStageRef: RefObject<HTMLDivElement | null>;
  isPanningRef: RefObject<boolean>;
  setSvgSize: Dispatch<SetStateAction<SvgSize | null>>;
  // Bumped externally whenever data/theme change so we can force a fresh DOM id.
  spans: unknown;
}

interface UseMermaidRendererReturn {
  error: string | null;
}

/**
 * Tags one actor/node with `data-kind` (so the CSS layer can theme it via
 * Chakra semantic tokens) and, when its label resolves to a span, wires a
 * click handler that selects that span.
 */
function tagNodeWithKindAndClick({
  node,
  result,
  isPanningRef,
  onSelectSpan,
}: {
  node: SVGGElement;
  result: MermaidRenderResult;
  isPanningRef: RefObject<boolean>;
  onSelectSpan: (spanId: string) => void;
}): void {
  const label = node.querySelector("text")?.textContent?.trim() ?? "";
  const match = label
    ? Array.from(result.idToSpanId.entries()).find(
        ([id]) => (result.idDisplay.get(id) ?? "").trim() === label.trim(),
      )
    : undefined;
  const kindFromClass = ["agent", "llm", "tool", "other"].find((k) => node.classList.contains(k));
  const kind = (match ? result.idKind.get(match[0]) : undefined) ?? kindFromClass ?? "other";
  node.setAttribute("data-kind", kind);
  if (match) {
    const [, spanId] = match;
    node.style.cursor = "pointer";
    node.addEventListener("click", (e) => {
      if (isPanningRef.current) return;
      e.stopPropagation();
      onSelectSpan(spanId);
    });
  }
}

/**
 * Easter-egg avatar swap. Each Mermaid `actor` contains a `<circle>` head — replace it
 * with an `<image>` at EASTER_EGG_IMAGE_URL, leaving the body line as its stand.
 */
function applyEasterEggAvatars(stage: HTMLDivElement): void {
  stage.querySelectorAll<SVGGElement>("g.actor").forEach((actor) => {
    const head = actor.querySelector<SVGCircleElement>("circle.actor-man-top, circle:not([class])");
    if (!head) return;
    const cx = Number(head.getAttribute("cx") ?? "0");
    const cy = Number(head.getAttribute("cy") ?? "0");
    const r = Number(head.getAttribute("r") ?? "8");
    const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", EASTER_EGG_IMAGE_URL);
    img.setAttribute("href", EASTER_EGG_IMAGE_URL);
    img.setAttribute("x", `${cx - r * 1.4}`);
    img.setAttribute("y", `${cy - r * 1.4}`);
    img.setAttribute("width", `${r * 2.8}`);
    img.setAttribute("height", `${r * 2.8}`);
    img.setAttribute("preserveAspectRatio", "xMidYMid slice");
    head.replaceWith(img);
  });
}

/** Mirrors the rendered SVG into the minimap container, scaled to fit. */
function mirrorIntoMinimap({
  minimapStageRef,
  svg,
  w,
  h,
}: {
  minimapStageRef: RefObject<HTMLDivElement | null>;
  svg: string;
  w: number;
  h: number;
}): void {
  const mini = minimapStageRef.current;
  if (!mini) return;
  mini.innerHTML = svg;
  const miniSvg = mini.querySelector<SVGSVGElement>("svg");
  if (!miniSvg) return;
  const scale = Math.min(MINIMAP_W / w, MINIMAP_H / h);
  const ox = (MINIMAP_W - w * scale) / 2;
  const oy = (MINIMAP_H - h * scale) / 2;
  miniSvg.style.maxWidth = "none";
  miniSvg.style.width = `${w}px`;
  miniSvg.style.height = `${h}px`;
  miniSvg.style.position = "absolute";
  miniSvg.style.left = `${ox}px`;
  miniSvg.style.top = `${oy}px`;
  miniSvg.style.transformOrigin = "0 0";
  miniSvg.style.transform = `scale(${scale})`;
  miniSvg.style.pointerEvents = "none";
}

/** Mermaid initialize() options — held fixed regardless of content, theme aside. */
function buildMermaidConfig(colorMode: "light" | "dark"): MermaidConfig {
  return {
    startOnLoad: false,
    theme: colorMode === "dark" ? "dark" : "default",
    securityLevel: "strict",
    themeVariables: {
      fontFamily:
        "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      fontSize: "12px",
    },
    sequence: {
      // Generous spacing values prevent label/lifeline overlap when
      // multiple agents call the same LLM in quick succession or when
      // participant names get long. wrap=false keeps labels on one
      // line; instead Mermaid widens the participant box to fit, and
      // actorMargin keeps adjacent participants from kissing.
      diagramMarginX: 16,
      diagramMarginY: 12,
      actorMargin: 96,
      width: 200,
      height: 36,
      boxMargin: 8,
      boxTextMargin: 5,
      noteMargin: 12,
      messageMargin: 38,
      messageAlign: "center",
      mirrorActors: false,
      bottomMarginAdj: 8,
      useMaxWidth: false,
      rightAngles: false,
      showSequenceNumbers: false,
      wrap: false,
    },
    flowchart: {
      htmlLabels: false,
      curve: "basis",
      nodeSpacing: 36,
      rankSpacing: 60,
      padding: 8,
      useMaxWidth: false,
    },
  };
}

/** Rounds the corners of actor lifelines and activation bars. */
function styleRenderedShapes(stage: HTMLDivElement): void {
  stage.querySelectorAll("rect.actor").forEach((rect) => {
    rect.setAttribute("rx", "6");
    rect.setAttribute("ry", "6");
  });
  stage.querySelectorAll("rect.activation0, rect.activation1, rect.activation2").forEach((rect) => {
    rect.setAttribute("rx", "2");
    rect.setAttribute("ry", "2");
  });
}

interface RenderMermaidArgs {
  stage: HTMLDivElement;
  result: MermaidRenderResult;
  colorMode: "light" | "dark";
  renderToken: number;
  easterEgg: boolean;
  onSelectSpan: (spanId: string) => void;
  isPanningRef: RefObject<boolean>;
  minimapStageRef: RefObject<HTMLDivElement | null>;
  setSvgSize: Dispatch<SetStateAction<SvgSize | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  isCancelled: () => boolean;
}

/** Loads Mermaid, renders the sequence diagram into `stage`, and mirrors it into the minimap. */
async function renderMermaidDiagram({
  stage,
  result,
  colorMode,
  renderToken,
  easterEgg,
  onSelectSpan,
  isPanningRef,
  minimapStageRef,
  setSvgSize,
  setError,
  isCancelled,
}: RenderMermaidArgs): Promise<void> {
  try {
    const mermaid = (await import("mermaid")).default;
    if (isCancelled()) return;
    mermaid.initialize(buildMermaidConfig(colorMode));

    const id = `mermaid-seq-${renderToken}-${Math.random().toString(36).slice(2, 9)}`;
    const { svg, bindFunctions } = await mermaid.render(id, result.syntax);
    if (isCancelled()) return;
    stage.innerHTML = svg;
    bindFunctions?.(stage);

    const svgEl = stage.querySelector<SVGSVGElement>("svg");
    if (!svgEl) return;
    svgEl.style.maxWidth = "none";
    svgEl.style.height = "auto";

    styleRenderedShapes(stage);

    // Tag every actor / node with `data-kind` so the CSS layer below can
    // theme them via Chakra semantic tokens. Click handlers wire span
    // selection. No JS-set fills or strokes — colours come exclusively
    // from CSS using Chakra's semantic-token-backed CSS vars (which are
    // light/dark aware by definition).
    stage.querySelectorAll<SVGGElement>("g.actor, g.node").forEach((node) => {
      tagNodeWithKindAndClick({ node, result, isPanningRef, onSelectSpan });
    });

    if (easterEgg) applyEasterEggAvatars(stage);

    const w =
      svgEl.viewBox?.baseVal?.width ||
      svgEl.width.baseVal.value ||
      svgEl.getBoundingClientRect().width;
    const h =
      svgEl.viewBox?.baseVal?.height ||
      svgEl.height.baseVal.value ||
      svgEl.getBoundingClientRect().height;
    setSvgSize({ width: w, height: h });

    // Mirror SVG into the minimap container.
    mirrorIntoMinimap({ minimapStageRef, svg, w, h });

    setError(null);
  } catch (err) {
    if (isCancelled()) return;
    setError(err instanceof Error ? err.message : String(err));
    stage.innerHTML = "";
  }
}

/**
 * Renders the Mermaid SVG into `stageRef`, mirrors a scaled-down copy into
 * `minimapStageRef`, wires actor/node click handlers to `onSelectSpan`, and applies the
 * easter-egg avatar swap when active.
 */
export function useMermaidRenderer({
  result,
  colorMode,
  easterEgg,
  onSelectSpan,
  stageRef,
  minimapStageRef,
  isPanningRef,
  setSvgSize,
  spans,
}: UseMermaidRendererArgs): UseMermaidRendererReturn {
  const [error, setError] = useState<string | null>(null);
  const [renderToken, setRenderToken] = useState(0);

  // Force a fresh render id whenever data / theme changes.
  useEffect(() => {
    setRenderToken((t) => t + 1);
  }, [spans, colorMode]);

  useEffect(() => {
    let cancelled = false;
    const stage = stageRef.current;
    if (!stage) return;
    if (!result.syntax || result.primaryCount === 0) {
      stage.innerHTML = "";
      setError(null);
      setSvgSize(null);
      return;
    }

    void renderMermaidDiagram({
      stage,
      result,
      colorMode,
      renderToken,
      easterEgg,
      onSelectSpan,
      isPanningRef,
      minimapStageRef,
      setSvgSize,
      setError,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    result,
    colorMode,
    renderToken,
    onSelectSpan,
    easterEgg,
    stageRef,
    minimapStageRef,
    isPanningRef,
    setSvgSize,
  ]);

  return { error };
}
