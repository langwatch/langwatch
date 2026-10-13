import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

import {
  DRAWER_GLASS_DEFAULT,
  type DrawerEdges,
  drawerEdges,
  NO_DRAWER_EDGES,
  sameDrawerEdges,
} from "./drawer-chrome.rules.ts";

const DrawerGlassContext = createContext<boolean>(DRAWER_GLASS_DEFAULT);

/** Turns the translucent header and footer on or off below it (stories, screenshots). */
export const DrawerGlassProvider = DrawerGlassContext.Provider;

/** Glass needs a framed body: a content-owned body keeps its panes and static separators. */
export function useDrawerGlass({ framed }: { framed: boolean }): boolean {
  return useContext(DrawerGlassContext) && framed;
}

interface Bands {
  body: HTMLElement;
  header: HTMLElement | null;
  footer: HTMLElement | null;
}

function bandHeight(band: HTMLElement | null): string {
  return `${band?.getBoundingClientRect().height ?? 0}px`;
}

/** Clearance for the overlaid bands goes to the body as custom properties, not React state. */
function writeClearance({ body, header, footer }: Bands): void {
  body.style.setProperty("--lw-drawer-top", bandHeight(header));
  body.style.setProperty("--lw-drawer-bottom", bandHeight(footer));
}

/** Watches the bands and the body's own children; returns the release. */
function watchBands({ bands, onChange }: { bands: Bands; onChange: () => void }): () => void {
  const { body, header, footer } = bands;
  const resizes = new ResizeObserver(onChange);
  const observeAll = () => {
    resizes.disconnect();
    for (const element of [body, header, footer, ...body.children]) {
      if (element) resizes.observe(element);
    }
  };
  const mutations = new MutationObserver(() => {
    observeAll();
    onChange();
  });
  mutations.observe(body, { childList: true });
  body.addEventListener("scroll", onChange, { passive: true });
  observeAll();
  return () => {
    body.removeEventListener("scroll", onChange);
    mutations.disconnect();
    resizes.disconnect();
    body.style.removeProperty("--lw-drawer-top");
    body.style.removeProperty("--lw-drawer-bottom");
  };
}

/**
 * The glass drawer's measured chrome: the body's padding follows the bands' real heights, and
 * an edge turns on only while content waits beyond it. State changes when an edge flips.
 */
export function useDrawerChrome({ enabled, hasFooter }: { enabled: boolean; hasFooter: boolean }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<DrawerEdges>(NO_DRAWER_EDGES);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!enabled || !body) return;
    const bands = { body, header: headerRef.current, footer: footerRef.current };
    const update = () => {
      writeClearance(bands);
      const next = drawerEdges(body);
      setEdges((previous) => (sameDrawerEdges(previous, next) ? previous : next));
    };
    const release = watchBands({ bands, onChange: update });
    update();
    return release;
  }, [enabled, hasFooter]);

  return { bodyRef, headerRef, footerRef, edges: enabled ? edges : NO_DRAWER_EDGES };
}
