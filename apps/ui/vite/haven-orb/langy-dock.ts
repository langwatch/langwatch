import { useEffect, useState } from "react";

/** The one attribute Langy's launcher carries for tools docking to it; Langy knows no more. */
export const LANGY_ANCHOR = "[data-langy-orb]";

/** The satellite's diameter, docked: a small moon of Langy's launcher. */
export const SATELLITE = 24;
/** Air between the satellite and the launcher's rim, so neither ring draws over the other. */
const RIM_GAP = 2;

/** The satellite's centre off the launcher's upper rim, facing the page; `edge` is its far side. */
export type Dock = { left: number; top: number; mirrored: boolean; edge: number };

const READ_EVERY_MS = 300;

/** Offset metrics ignore the transform Langy's proximity lean drives, so the dock holds still. */
export function readDock({ host }: { host: Window }): Dock | undefined {
  const anchor = host.document.querySelector<HTMLElement>(LANGY_ANCHOR);
  if (!anchor || anchor.offsetWidth === 0) return undefined;
  const radius = anchor.offsetWidth / 2;
  const centreX = anchor.offsetLeft + radius;
  const lean = (radius + SATELLITE / 2 + RIM_GAP) * Math.SQRT1_2;
  const mirrored = centreX < host.innerWidth / 2;
  return {
    left: Math.round(mirrored ? centreX + lean : centreX - lean),
    top: Math.round(anchor.offsetTop + radius - lean),
    mirrored,
    edge: Math.round(radius + lean),
  };
}

const sameDock = (a: Dock | undefined, b: Dock | undefined) =>
  a?.left === b?.left && a?.top === b?.top && a?.mirrored === b?.mirrored && a?.edge === b?.edge;

/** Follows Langy's launcher as it mounts, unmounts or dodges a drawer; undefined when absent. */
export function useLangyDock({ host }: { host: Window }): Dock | undefined {
  const [dock, setDock] = useState(() => readDock({ host }));
  useEffect(() => {
    const update = () => {
      const next = readDock({ host });
      setDock((previous) => (sameDock(previous, next) ? previous : next));
    };
    // ponytail: a 300ms read (one query, four offsets); observe mutations if it shows in a profile.
    const timer = host.setInterval(update, READ_EVERY_MS);
    host.addEventListener("resize", update);
    return () => {
      host.clearInterval(timer);
      host.removeEventListener("resize", update);
    };
  }, [host]);
  return dock;
}
