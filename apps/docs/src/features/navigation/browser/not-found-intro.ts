/* The 404's intro (specs/rendering.feature): the static page draws the LangWatch mark until the
   island has picked the scene. Then the mark finishes its stroke from wherever the loop is, fills,
   and a copy flies to the scene's own mark: Langy's in the terminal, the trace's service mark or
   the castle's turret. The copy carries its colours inline, as it leaves the intro's styles. */
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const SETTLE_MS = 220;
const FLIGHT_MS = 640;

function settle({ path }: { path: SVGPathElement }) {
  const style = getComputedStyle(path);
  const offset = style.strokeDashoffset;
  const colour = style.stroke;
  path.style.animation = "none";
  return path
    .animate(
      [
        { strokeDashoffset: offset, fill: "transparent" },
        { strokeDashoffset: "0", fill: colour },
      ],
      { duration: SETTLE_MS, easing: "ease-out", fill: "forwards" },
    )
    .finished.then(
      () => colour,
      () => colour,
    );
}

/** The intro is on screen until the scene shows or the 1.2s CSS fallback hides it. */
const onScreen = (svg: SVGSVGElement) =>
  getComputedStyle(svg).visibility === "visible" && svg.getClientRects().length > 0;

/** Shows the scene, flying the intro's mark into it when the intro is still on screen. */
export async function arrive({ root }: { root: HTMLElement }) {
  const from = root.querySelector<SVGSVGElement>("[data-nf-intro] svg");
  const path = from?.querySelector("path");
  if (!from || !path || !onScreen(from) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.dataset.ready = "";
    return;
  }
  const colour = await settle({ path });
  /* The fallback may have hidden the intro while its stroke settled: then the scene just shows. */
  if (!onScreen(from)) {
    root.dataset.ready = "";
    return;
  }
  const start = from.getBoundingClientRect();
  const base = root.getBoundingClientRect();
  const ghost = from.cloneNode(true) as SVGSVGElement;
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${start.left - base.left}px`,
    top: `${start.top - base.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
    margin: "0",
    overflow: "visible",
    transformOrigin: "0 0",
    pointerEvents: "none",
    zIndex: "1",
  });
  Object.assign(ghost.querySelector("path")!.style, {
    fill: colour,
    stroke: "none",
    animation: "none",
  });
  root.append(ghost);
  root.dataset.flight = "";
  root.dataset.ready = "";
  const target = root.querySelector("[data-nf-stage] [data-nf-mark]");
  if (!target) return ghost.remove();
  const end = target.getBoundingClientRect();
  const scale = Math.min(end.width / start.width, end.height / start.height);
  const dx = end.left - start.left + (end.width - start.width * scale) / 2;
  const dy = end.top - start.top + (end.height - start.height * scale) / 2;
  target.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], {
    duration: FLIGHT_MS,
    fill: "backwards",
  });
  ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
    duration: FLIGHT_MS,
    fill: "forwards",
  });
  await ghost
    .animate(
      [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
      {
        duration: FLIGHT_MS,
        easing: EASE,
        fill: "forwards",
      },
    )
    .finished.catch(() => undefined);
  ghost.remove();
}
