import { Box, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import mermaid from "mermaid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCheck,
  LuCopy,
  LuFilter,
  LuMaximize,
  LuMessagesSquare,
  LuMinus,
  LuNetwork,
  LuPlus,
} from "react-icons/lu";
import { useColorMode } from "~/components/ui/color-mode";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { generateMermaidSyntax } from "./mermaid";
import { generateTopologySyntax } from "./topologyMermaid";
import {
  DEFAULT_SEQUENCE_TYPES,
  SEQUENCE_SPAN_TYPES,
  type SequenceSpanType,
  type SequenceViewProps,
} from "./types";

type SubMode = "topology" | "sequence";

const SUB_MODE_STORAGE_KEY = "langwatch:traces-v2:sequence-submode";

// ── Easter egg ───────────────────────────────────────────────────────────
// Press ↑ ↑ ↓ ↓ ← → ← → while the sequence view is mounted to swap every
// stick-figure actor head for an image. The image URL is a placeholder for
// now — swap `EASTER_EGG_IMAGE_URL` for a real photo when ready. Pressing
// the sequence again toggles it off.
const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
] as const;

// Placeholder avatar — a tasteful gradient SVG. Drop in a real photo URL
// (or imported asset) here when you want to surprise someone.
const EASTER_EGG_IMAGE_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#A855F7"/>
          <stop offset="100%" stop-color="#3B82F6"/>
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#g)"/>
      <circle cx="24" cy="28" r="3" fill="#fff"/>
      <circle cx="40" cy="28" r="3" fill="#fff"/>
      <path d="M22 40 Q32 48 42 40" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  );

function readStoredSubMode(): SubMode {
  if (typeof window === "undefined") return "topology";
  const raw = localStorage.getItem(SUB_MODE_STORAGE_KEY);
  return raw === "topology" || raw === "sequence" ? raw : "topology";
}

const TYPE_LABELS: Record<SequenceSpanType, string> = {
  agent: "Agents",
  llm: "LLMs",
  tool: "Tools",
  chain: "Chains",
  rag: "RAG",
  guardrail: "Guardrails",
  evaluation: "Evals",
  workflow: "Workflows",
  component: "Components",
  module: "Modules",
  server: "Server",
  client: "Client",
  producer: "Producer",
  consumer: "Consumer",
  task: "Tasks",
  span: "Generic spans",
  unknown: "Unknown",
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;
const FIT_PADDING = 16;
const DRAG_THRESHOLD_PX = 4;
const ZOOM_ANIMATION_MS = 220;
const PINCH_SENSITIVITY = 0.01;

const MINIMAP_W = 200;
const MINIMAP_H = 72;

interface SvgSize {
  width: number;
  height: number;
}

interface View {
  x: number;
  y: number;
  z: number;
}

const IDENTITY: View = { x: 0, y: 0, z: 1 };

// Use Mermaid's stock "default" / "dark" theme — no per-token overrides. We
// don't try to win the theming fight against Mermaid's internal style block
// any more; we just pick the right preset for the current colour mode and let
// it render natively. The Chakra-themed chrome around the diagram (toolbar,
// minimap, canvas bg) provides the LangWatch context.

function countParticipants(
  spans: SequenceViewProps["spans"],
  types: ReadonlySet<string>,
): number {
  const set = new Set<string>();
  for (const span of spans) {
    if (!types.has(span.type ?? "span")) continue;
    if (span.type === "tool") continue;
    const key =
      span.type === "llm" && span.model
        ? `llm:${span.model}`
        : span.type === "agent"
          ? `agent:${span.name}`
          : `other:${span.name}`;
    set.add(key);
  }
  return set.size;
}

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function SequenceView({
  spans,
  selectedSpanId,
  onSelectSpan,
}: SequenceViewProps) {
  const { colorMode } = useColorMode();

  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;

  const [svgSize, setSvgSize] = useState<SvgSize | null>(null);
  const svgSizeRef = useRef<SvgSize | null>(null);
  svgSizeRef.current = svgSize;

  const [viewportSize, setViewportSize] = useState<SvgSize>({
    width: 0,
    height: 0,
  });
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  const [error, setError] = useState<string | null>(null);
  const [renderToken, setRenderToken] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<SequenceSpanType[]>(
    DEFAULT_SEQUENCE_TYPES,
  );
  const [subMode, setSubMode] = useState<SubMode>(readStoredSubMode);
  const [easterEgg, setEasterEgg] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SUB_MODE_STORAGE_KEY, subMode);
    }
  }, [subMode]);

  // Konami listener. Listens at the document level so the user can be
  // anywhere inside the drawer when triggering it. We only consume arrow
  // keys for matching — other keys reset the buffer.
  useEffect(() => {
    const buffer: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (!KONAMI_SEQUENCE.includes(e.key as (typeof KONAMI_SEQUENCE)[number])) {
        buffer.length = 0;
        return;
      }
      buffer.push(e.key);
      if (buffer.length > KONAMI_SEQUENCE.length) buffer.shift();
      if (
        buffer.length === KONAMI_SEQUENCE.length &&
        buffer.every((k, i) => k === KONAMI_SEQUENCE[i])
      ) {
        setEasterEgg((prev) => !prev);
        buffer.length = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const minimapStageRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const isPanningRef = useRef(false);

  // Auto-include "span" bucket on first load if default filter would be sparse.
  useEffect(() => {
    setSelectedTypes((prev) => {
      if (prev.includes("span")) return prev;
      if (countParticipants(spans, new Set<string>(prev)) > 1) return prev;
      return [...prev, "span"];
    });
  }, [spans]);

  // Unified render result shape so the renderer doesn't have to know which
  // syntax it's drawing. Both generators populate the same id → span maps for
  // click-to-select.
  const result = useMemo(() => {
    if (subMode === "topology") {
      const r = generateTopologySyntax(spans, selectedTypes, colorMode);
      const kindMap = new Map<string, string>();
      for (const node of r.nodes) kindMap.set(node.id, node.kind);
      return {
        syntax: r.syntax,
        idToSpanId: r.nodeToSpanId,
        idDisplay: r.nodeDisplay,
        idKind: kindMap,
        primaryCount: r.nodes.length,
        secondaryCount: r.edgeCount,
        countLabel: `${r.nodes.length}n · ${r.edgeCount}e`,
      };
    }
    const r = generateMermaidSyntax(spans, selectedTypes);
    const kindMap = new Map<string, string>();
    for (const [id, kind] of r.participantKind) kindMap.set(id, kind);
    return {
      syntax: r.syntax,
      idToSpanId: r.participantToSpanId,
      idDisplay: r.participantDisplay,
      idKind: kindMap,
      primaryCount: r.participants.length,
      secondaryCount: r.messageCount,
      countLabel: `${r.participants.length}p · ${r.messageCount}m`,
    };
  }, [spans, selectedTypes, subMode, colorMode]);

  const presentTypeSet = useMemo(() => {
    const set = new Set<SequenceSpanType>();
    for (const span of spans) {
      const t = (span.type ?? "span") as SequenceSpanType;
      if (SEQUENCE_SPAN_TYPES.includes(t)) set.add(t);
      else set.add("unknown");
    }
    return set;
  }, [spans]);

  const availableSelectedCount = selectedTypes.filter((t) =>
    presentTypeSet.has(t),
  ).length;

  // Track viewport size — needed for fit + minimap math.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const computeFit = useCallback((): View | null => {
    const size = svgSizeRef.current;
    const vp = viewportSizeRef.current;
    if (!size || !vp.width || !vp.height) return null;
    const sx = (vp.width - FIT_PADDING * 2) / size.width;
    const sy = (vp.height - FIT_PADDING * 2) / size.height;
    const z = clampZoom(Math.min(sx, sy, 1.5));
    return {
      z,
      x: (vp.width - size.width * z) / 2,
      y: (vp.height - size.height * z) / 2,
    };
  }, []);

  const animateTo = useCallback(
    (target: View) => {
      cancelAnimation();
      const from = viewRef.current;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / ZOOM_ANIMATION_MS);
        const e = 1 - Math.pow(1 - t, 3);
        setView({
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          z: from.z + (target.z - from.z) * e,
        });
        if (t < 1) animationRef.current = requestAnimationFrame(tick);
        else animationRef.current = null;
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation],
  );

  const fit = useCallback(
    (animate = false) => {
      const target = computeFit();
      if (!target) return;
      if (animate) animateTo(target);
      else setView(target);
    },
    [computeFit, animateTo],
  );

  // Render mermaid SVG.
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

    void (async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: colorMode === "dark" ? "dark" : "default",
          securityLevel: "loose",
          themeVariables: {
            fontFamily:
              "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
            fontSize: "12px",
          },
          sequence: {
            diagramMarginX: 12,
            diagramMarginY: 8,
            actorMargin: 48,
            width: 170,
            height: 32,
            boxMargin: 4,
            boxTextMargin: 3,
            noteMargin: 8,
            messageMargin: 26,
            messageAlign: "center",
            mirrorActors: false,
            bottomMarginAdj: 4,
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
        });

        const id = `mermaid-seq-${renderToken}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const { svg, bindFunctions } = await mermaid.render(id, result.syntax);
        if (cancelled || !stage) return;
        stage.innerHTML = svg;
        bindFunctions?.(stage);

        const svgEl = stage.querySelector<SVGSVGElement>("svg");
        if (!svgEl) return;
        svgEl.style.maxWidth = "none";
        svgEl.style.height = "auto";

        stage.querySelectorAll("rect.actor").forEach((rect) => {
          rect.setAttribute("rx", "6");
          rect.setAttribute("ry", "6");
        });
        stage
          .querySelectorAll(
            "rect.activation0, rect.activation1, rect.activation2",
          )
          .forEach((rect) => {
            rect.setAttribute("rx", "2");
            rect.setAttribute("ry", "2");
          });

        // Tag every actor / node with `data-kind` so the CSS layer below can
        // theme them via Chakra semantic tokens. Click handlers wire span
        // selection. No JS-set fills or strokes — colours come exclusively
        // from CSS using Chakra's semantic-token-backed CSS vars (which are
        // light/dark aware by definition).
        stage
          .querySelectorAll<SVGGElement>("g.actor, g.node")
          .forEach((node) => {
            const label =
              node.querySelector("text")?.textContent?.trim() ?? "";
            const match = label
              ? Array.from(result.idToSpanId.entries()).find(
                  ([id]) =>
                    (result.idDisplay.get(id) ?? "").trim() === label.trim(),
                )
              : undefined;
            const kindFromClass = ["agent", "llm", "tool", "other"].find((k) =>
              node.classList.contains(k),
            );
            const kind =
              (match ? result.idKind.get(match[0]) : undefined) ??
              kindFromClass ??
              "other";
            node.setAttribute("data-kind", kind);
            if (match) {
              const [, spanId] = match;
              (node as unknown as HTMLElement).style.cursor = "pointer";
              node.addEventListener("click", (e) => {
                if (isPanningRef.current) return;
                e.stopPropagation();
                onSelectSpan(spanId);
              });
            }
          });

        // Easter-egg avatar swap. Each Mermaid `actor` (stick figure)
        // contains a `<circle>` for the head — we replace it with an
        // `<image>` element pointing at EASTER_EGG_IMAGE_URL. The legs/body
        // line stays put (looks like a body holding up an emoji avatar).
        if (easterEgg) {
          stage
            .querySelectorAll<SVGGElement>("g.actor")
            .forEach((actor) => {
              const head = actor.querySelector<SVGCircleElement>(
                "circle.actor-man-top, circle:not([class])",
              );
              if (!head) return;
              const cx = Number(head.getAttribute("cx") ?? "0");
              const cy = Number(head.getAttribute("cy") ?? "0");
              const r = Number(head.getAttribute("r") ?? "8");
              const img = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "image",
              );
              img.setAttributeNS(
                "http://www.w3.org/1999/xlink",
                "href",
                EASTER_EGG_IMAGE_URL,
              );
              img.setAttribute("href", EASTER_EGG_IMAGE_URL);
              img.setAttribute("x", `${cx - r * 1.4}`);
              img.setAttribute("y", `${cy - r * 1.4}`);
              img.setAttribute("width", `${r * 2.8}`);
              img.setAttribute("height", `${r * 2.8}`);
              img.setAttribute("preserveAspectRatio", "xMidYMid slice");
              head.replaceWith(img);
            });
        }

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
        const mini = minimapStageRef.current;
        if (mini) {
          mini.innerHTML = svg;
          const miniSvg = mini.querySelector<SVGSVGElement>("svg");
          if (miniSvg) {
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
        }

        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        if (stage) stage.innerHTML = "";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, colorMode, renderToken, onSelectSpan, easterEgg]);

  // Force a fresh render id whenever data / theme changes.
  useEffect(() => {
    setRenderToken((t) => t + 1);
  }, [spans, colorMode]);

  // Auto-fit on fresh diagram or viewport resize.
  useEffect(() => {
    if (!svgSize || !viewportSize.width || !viewportSize.height) return;
    fit(false);
  }, [svgSize, viewportSize.width, viewportSize.height, fit]);

  const toggleType = useCallback((type: SequenceSpanType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  // Wheel: pinch (ctrl/meta) zooms toward cursor; otherwise pan.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * PINCH_SENSITIVITY);
        const v = viewRef.current;
        const next = clampZoom(v.z * factor);
        if (next === v.z) return;
        setView({
          z: next,
          x: ax - ((ax - v.x) * next) / v.z,
          y: ay - ((ay - v.y) * next) / v.z,
        });
        return;
      }
      e.preventDefault();
      const v = viewRef.current;
      setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [cancelAnimation]);

  // Drag-to-pan; actors get clicks on no-drag.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      cancelAnimation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startView = viewRef.current;
      let dragged = false;

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragged && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
          dragged = true;
          isPanningRef.current = true;
          document.body.style.cursor = "grabbing";
        }
        if (!dragged) return;
        setView({
          ...startView,
          x: startView.x + dx,
          y: startView.y + dy,
        });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        document.body.style.cursor = "";
        // Defer flag reset so synchronous click handlers see we just dragged.
        setTimeout(() => {
          isPanningRef.current = false;
        }, 0);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [cancelAnimation],
  );

  // Double-click: zoom in 2× at cursor, or fit if already zoomed in.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const v = viewRef.current;
      if (v.z >= 1.6) {
        const fitTarget = computeFit();
        if (fitTarget) animateTo(fitTarget);
        return;
      }
      const next = clampZoom(v.z * 2);
      animateTo({
        z: next,
        x: ax - ((ax - v.x) * next) / v.z,
        y: ay - ((ay - v.y) * next) / v.z,
      });
    },
    [animateTo, computeFit],
  );

  const handleZoomBtn = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      const next = clampZoom(v.z * factor);
      if (next === v.z) return;
      const cx = viewportSizeRef.current.width / 2;
      const cy = viewportSizeRef.current.height / 2;
      animateTo({
        z: next,
        x: cx - ((cx - v.x) * next) / v.z,
        y: cy - ((cy - v.y) * next) / v.z,
      });
    },
    [animateTo],
  );

  const handleResetFit = useCallback(() => {
    const target = computeFit();
    if (target) animateTo(target);
  }, [computeFit, animateTo]);

  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const size = svgSizeRef.current;
      const vp = viewportSizeRef.current;
      if (!size || !vp.width) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = Math.min(MINIMAP_W / size.width, MINIMAP_H / size.height);
      const ox = (MINIMAP_W - size.width * scale) / 2;
      const oy = (MINIMAP_H - size.height * scale) / 2;
      const cx = e.clientX - rect.left - ox;
      const cy = e.clientY - rect.top - oy;
      const svgX = cx / scale;
      const svgY = cy / scale;
      const v = viewRef.current;
      animateTo({
        z: v.z,
        x: vp.width / 2 - svgX * v.z,
        y: vp.height / 2 - svgY * v.z,
      });
    },
    [animateTo],
  );

  const hasParticipants = result.primaryCount > 0;

  // Minimap viewport-rect rect in minimap pixel space.
  const minimapRect = useMemo(() => {
    if (!svgSize || !viewportSize.width) return null;
    const scale = Math.min(
      MINIMAP_W / svgSize.width,
      MINIMAP_H / svgSize.height,
    );
    const ox = (MINIMAP_W - svgSize.width * scale) / 2;
    const oy = (MINIMAP_H - svgSize.height * scale) / 2;
    return {
      x: (-view.x / view.z) * scale + ox,
      y: (-view.y / view.z) * scale + oy,
      w: (viewportSize.width / view.z) * scale,
      h: (viewportSize.height / view.z) * scale,
    };
  }, [svgSize, viewportSize.width, viewportSize.height, view]);

  return (
    <VStack align="stretch" gap={0} height="full" overflow="hidden" bg="bg">
      <Flex
        align="center"
        gap={1.5}
        paddingX={2.5}
        paddingY={1}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/60"
        flexShrink={0}
      >
        <SubModeToggle value={subMode} onChange={setSubMode} />
        <Box
          width="1px"
          height="14px"
          bg="border.subtle"
          flexShrink={0}
        />
        <Menu.Root>
          <Menu.Trigger asChild>
            <Flex
              as="button"
              align="center"
              gap={1}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="sm"
              color="fg.muted"
              cursor="pointer"
              _hover={{ bg: "bg.muted", color: "fg" }}
              transition="all 0.15s ease"
              title="Filter span types"
            >
              <Icon as={LuFilter} boxSize={3} />
              <Text textStyle="2xs" lineHeight={1} fontWeight={500}>
                {availableSelectedCount === presentTypeSet.size
                  ? "All types"
                  : `${availableSelectedCount}/${presentTypeSet.size}`}
              </Text>
            </Flex>
          </Menu.Trigger>
          <Menu.Content minWidth="200px">
            {SEQUENCE_SPAN_TYPES.map((type) => {
              const active = selectedTypes.includes(type);
              const present = presentTypeSet.has(type);
              return (
                <Menu.CheckboxItem
                  key={type}
                  value={type}
                  checked={active}
                  onCheckedChange={() => toggleType(type)}
                  disabled={!present}
                >
                  <Flex
                    align="center"
                    justify="space-between"
                    width="full"
                    gap={2}
                    opacity={present ? 1 : 0.45}
                  >
                    <Text textStyle="xs">{TYPE_LABELS[type]}</Text>
                    {!present ? (
                      <Text textStyle="2xs" color="fg.subtle">
                        none
                      </Text>
                    ) : null}
                  </Flex>
                </Menu.CheckboxItem>
              );
            })}
          </Menu.Content>
        </Menu.Root>

        <Box flex="1" />

        <HStack gap={0.5} flexShrink={0}>
          <ZoomButton
            label="Zoom out"
            icon={LuMinus}
            onClick={() => handleZoomBtn(1 / ZOOM_STEP)}
          />
          <Tooltip content="Fit to screen" positioning={{ placement: "top" }}>
            <Box
              as="button"
              onClick={handleResetFit}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="sm"
              color="fg.muted"
              cursor="pointer"
              _hover={{ bg: "bg.muted", color: "fg" }}
              transition="all 0.15s ease"
              minWidth="38px"
            >
              <Text
                textStyle="2xs"
                lineHeight={1}
                fontVariantNumeric="tabular-nums"
                fontWeight={500}
              >
                {Math.round(view.z * 100)}%
              </Text>
            </Box>
          </Tooltip>
          <ZoomButton
            label="Zoom in"
            icon={LuPlus}
            onClick={() => handleZoomBtn(ZOOM_STEP)}
          />
          <ZoomButton
            label="Fit to screen"
            icon={LuMaximize}
            onClick={handleResetFit}
          />
          <CopySourceButton syntax={result.syntax} />
        </HStack>

        <Text
          textStyle="2xs"
          color="fg.subtle"
          flexShrink={0}
          marginLeft={1.5}
          fontWeight={500}
        >
          {result.countLabel}
        </Text>
      </Flex>

      <Box
        ref={viewportRef}
        flex="1"
        overflow="hidden"
        position="relative"
        bg="bg"
        cursor={hasParticipants ? "grab" : "default"}
        onPointerDown={hasParticipants ? handlePointerDown : undefined}
        onDoubleClick={hasParticipants ? handleDoubleClick : undefined}
        css={{
          touchAction: "none",
          userSelect: "none",
          backgroundImage:
            colorMode === "dark"
              ? "radial-gradient(circle, rgba(82,82,91,0.18) 1px, transparent 1px)"
              : "radial-gradient(circle, rgba(148,163,184,0.20) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        {error ? (
          <Flex align="center" justify="center" height="full" padding={4}>
            <VStack gap={2}>
              <Text textStyle="sm" color="fg.error">
                Could not render sequence diagram
              </Text>
              <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                {error}
              </Text>
            </VStack>
          </Flex>
        ) : !hasParticipants ? (
          <Flex
            align="center"
            justify="center"
            height="full"
            padding={4}
            direction="column"
            gap={1}
          >
            <Text textStyle="sm" color="fg">
              No interactions to plot
            </Text>
            <Text textStyle="xs" color="fg.subtle">
              No agent, LLM, or tool spans match the current filters.
            </Text>
          </Flex>
        ) : (
          <Box
            ref={stageRef}
            position="absolute"
            top="0"
            left="0"
            transformOrigin="0 0"
            data-selected-span-id={selectedSpanId ?? ""}
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`,
              willChange: "transform",
            }}
            css={{
              "& svg": { display: "block" },
            }}
          />
        )}

        {hasParticipants && minimapRect ? (
          <Box
            position="absolute"
            bottom={2}
            right={2}
            width={`${MINIMAP_W}px`}
            height={`${MINIMAP_H}px`}
            borderRadius="md"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg.panel/85"
            backdropFilter="blur(6px)"
            boxShadow="sm"
            overflow="hidden"
            cursor="pointer"
            onClick={handleMinimapClick}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Box ref={minimapStageRef} position="absolute" inset={0} />
            <Box
              position="absolute"
              top="0"
              left="0"
              borderWidth="1.5px"
              borderColor="purple.fg"
              bg="purple.subtle"
              opacity={0.4}
              pointerEvents="none"
              borderRadius="xs"
              style={{
                transform: `translate3d(${minimapRect.x}px, ${minimapRect.y}px, 0)`,
                width: `${minimapRect.w}px`,
                height: `${minimapRect.h}px`,
              }}
            />
          </Box>
        ) : null}
      </Box>
    </VStack>
  );
}

interface ZoomButtonProps {
  label: string;
  icon: typeof LuPlus;
  onClick: () => void;
}

function CopySourceButton({ syntax }: { syntax: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    void navigator.clipboard.writeText(syntax).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [syntax]);
  return (
    <Tooltip
      content={copied ? "Copied!" : "Copy Mermaid source"}
      positioning={{ placement: "top" }}
    >
      <Flex
        as="button"
        align="center"
        justify="center"
        width="20px"
        height="20px"
        borderRadius="sm"
        color={copied ? "green.fg" : "fg.muted"}
        cursor="pointer"
        _hover={{ bg: "bg.muted", color: copied ? "green.fg" : "fg" }}
        transition="all 0.15s ease"
        onClick={onClick}
      >
        <Icon as={copied ? LuCheck : LuCopy} boxSize={2.5} />
      </Flex>
    </Tooltip>
  );
}

function ZoomButton({ label, icon, onClick }: ZoomButtonProps) {
  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <Flex
        as="button"
        align="center"
        justify="center"
        width="20px"
        height="20px"
        borderRadius="sm"
        color="fg.muted"
        cursor="pointer"
        _hover={{ bg: "bg.muted", color: "fg" }}
        transition="all 0.15s ease"
        onClick={onClick}
      >
        <Icon as={icon} boxSize={2.5} />
      </Flex>
    </Tooltip>
  );
}

const SUB_MODES: {
  value: SubMode;
  label: string;
  icon: typeof LuNetwork;
  tooltip: string;
}[] = [
  {
    value: "topology",
    label: "Topology",
    icon: LuNetwork,
    tooltip: "Topology — who calls whom",
  },
  {
    value: "sequence",
    label: "Sequence",
    icon: LuMessagesSquare,
    tooltip: "Sequence — chronological message flow",
  },
];

function SubModeToggle({
  value,
  onChange,
}: {
  value: SubMode;
  onChange: (mode: SubMode) => void;
}) {
  return (
    <HStack
      gap={0}
      bg="bg.muted/60"
      borderRadius="sm"
      padding={0.5}
      flexShrink={0}
    >
      {SUB_MODES.map((mode) => {
        const active = value === mode.value;
        return (
          <Tooltip
            key={mode.value}
            content={mode.tooltip}
            positioning={{ placement: "top" }}
          >
            <Flex
              as="button"
              align="center"
              gap={1}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="xs"
              cursor="pointer"
              bg={active ? "bg.panel" : "transparent"}
              color={active ? "fg" : "fg.muted"}
              boxShadow={active ? "xs" : "none"}
              _hover={{ color: "fg" }}
              transition="all 0.12s ease"
              onClick={() => onChange(mode.value)}
            >
              <Icon as={mode.icon} boxSize={3} />
              <Text textStyle="2xs" lineHeight={1} fontWeight={500}>
                {mode.label}
              </Text>
            </Flex>
          </Tooltip>
        );
      })}
    </HStack>
  );
}
