import mermaid from "mermaid";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useState } from "react";

import { EASTER_EGG_IMAGE_URL } from "../use-konami-easter-egg.ts";

// Mermaid stays in its own chunk: `SequenceView` is its only importer and loads through `lazy()`.

const MINIMAP_W = 200;
const MINIMAP_H = 72;

interface SvgSize {
  width: number;
  height: number;
}

interface MermaidRenderResult {
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

function mermaidConfig(colorMode: "light" | "dark"): Parameters<typeof mermaid.initialize>[0] {
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

/** Rounded actor boxes and activation bars. */
function roundCorners(stage: HTMLElement) {
  stage.querySelectorAll("rect.actor").forEach((rect) => {
    rect.setAttribute("rx", "6");
    rect.setAttribute("ry", "6");
  });
  stage.querySelectorAll("rect.activation0, rect.activation1, rect.activation2").forEach((rect) => {
    rect.setAttribute("rx", "2");
    rect.setAttribute("ry", "2");
  });
}

/**
 * The easter-egg avatar swap: each stick-figure actor's head circle becomes an
 * image, and the body stays put under it.
 */
function swapActorHeads(stage: HTMLElement) {
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

function svgSizeOf(svgEl: SVGSVGElement): SvgSize {
  return {
    width:
      svgEl.viewBox?.baseVal?.width ||
      svgEl.width.baseVal.value ||
      svgEl.getBoundingClientRect().width,
    height:
      svgEl.viewBox?.baseVal?.height ||
      svgEl.height.baseVal.value ||
      svgEl.getBoundingClientRect().height,
  };
}

/** A scaled-down, centred, inert copy of the diagram in the minimap. */
function mirrorIntoMinimap({ mini, svg, size }: { mini: HTMLElement; svg: string; size: SvgSize }) {
  mini.innerHTML = svg;
  const miniSvg = mini.querySelector<SVGSVGElement>("svg");
  if (!miniSvg) return;
  const { width: w, height: h } = size;
  const scale = Math.min(MINIMAP_W / w, MINIMAP_H / h);
  Object.assign(miniSvg.style, {
    maxWidth: "none",
    width: `${w}px`,
    height: `${h}px`,
    position: "absolute",
    left: `${(MINIMAP_W - w * scale) / 2}px`,
    top: `${(MINIMAP_H - h * scale) / 2}px`,
    transformOrigin: "0 0",
    transform: `scale(${scale})`,
    pointerEvents: "none",
  });
}

/**
 * Renders the diagram into the stage and dresses it: rounded corners, a kind
 * and span click per node, the easter egg, the minimap copy. Returns its size;
 * nothing once cancelled or when no svg came back.
 */
async function renderDiagram({
  stage,
  mini,
  renderToken,
  colorMode,
  easterEgg,
  result,
  isPanningRef,
  onSelectSpan,
  isCancelled,
}: {
  stage: HTMLElement;
  mini: HTMLElement | null;
  renderToken: number;
  colorMode: "light" | "dark";
  easterEgg: boolean;
  result: MermaidRenderResult;
  isPanningRef: RefObject<boolean>;
  onSelectSpan: (spanId: string) => void;
  isCancelled: () => boolean;
}): Promise<SvgSize[]> {
  mermaid.initialize(mermaidConfig(colorMode));
  const id = `mermaid-seq-${renderToken}-${Math.random().toString(36).slice(2, 9)}`;
  const { svg, bindFunctions } = await mermaid.render(id, result.syntax);
  if (isCancelled()) return [];
  stage.innerHTML = svg;
  bindFunctions?.(stage);
  const svgEl = stage.querySelector<SVGSVGElement>("svg");
  if (!svgEl) return [];
  svgEl.style.maxWidth = "none";
  svgEl.style.height = "auto";
  roundCorners(stage);
  stage.querySelectorAll<SVGGElement>("g.actor, g.node").forEach((node) => {
    tagNodeWithKindAndClick({ node, result, isPanningRef, onSelectSpan });
  });
  if (easterEgg) swapActorHeads(stage);
  const size = svgSizeOf(svgEl);
  if (mini) mirrorIntoMinimap({ mini, svg, size });
  return [size];
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

    renderDiagram({
      stage,
      mini: minimapStageRef.current,
      renderToken,
      colorMode,
      easterEgg,
      result,
      isPanningRef,
      onSelectSpan,
      isCancelled: () => cancelled,
    })
      .then((sizes) => {
        for (const size of sizes) {
          setSvgSize(size);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        stage.innerHTML = "";
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
