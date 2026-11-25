import { z } from "zod";

import type { Box } from "./feedback";

const boxOf = ({ element }: { element: Element }): Box => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

const swallow = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};

const SWALLOWED = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const;

const fiberSchema = z.object({ type: z.unknown(), return: z.unknown() });

/** The nearest named React component that rendered the element, read from its dev fiber. */
export function componentOf({ element }: { element: Element }): string | undefined {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : undefined;
  for (let depth = 0; depth < 30; depth += 1) {
    const parsed = fiberSchema.safeParse(fiber);
    if (!parsed.success) return undefined;
    const { type } = parsed.data;
    if (typeof type === "function" && /^[A-Z]/u.test(type.name)) return type.name;
    fiber = parsed.data.return;
  }
  return undefined;
}

/** What the picker's label names: the component, the nearest test id and the size. */
export type Hovered = { box: Box; tag: string; component?: string; testId?: string };

const hoveredOf = ({ element }: { element: Element }): Hovered => {
  const testId = element.closest("[data-testid]")?.getAttribute("data-testid") ?? undefined;
  return {
    box: boxOf({ element }),
    tag: element.tagName.toLowerCase(),
    component: componentOf({ element }),
    ...(testId ? { testId } : {}),
  };
};

/** Hover reports the element under the pointer, a click locks it and Escape cancels; the page
 * sees none of it. */
export function pickElement({
  host,
  isOwn,
  onHover,
}: {
  host: Window;
  isOwn: (element: Element) => boolean;
  onHover: (hovered: Hovered) => void;
}): Promise<Element | undefined> {
  const doc = host.document;
  const controller = new AbortController();
  const listen = { capture: true, signal: controller.signal };
  const under = (event: MouseEvent) => {
    const element = doc.elementFromPoint(event.clientX, event.clientY);
    return element && !isOwn(element) ? element : undefined;
  };
  return new Promise((resolve) => {
    const finish = (element: Element | undefined) => {
      controller.abort();
      resolve(element);
    };
    doc.addEventListener(
      "mousemove",
      (event) => {
        const element = under(event);
        if (element) onHover(hoveredOf({ element }));
      },
      listen,
    );
    for (const type of SWALLOWED) doc.addEventListener(type, swallow, listen);
    doc.addEventListener("click", (event) => finish(under(event)), listen);
    doc.addEventListener("keydown", (event) => event.key === "Escape" && finish(undefined), listen);
  });
}

/** A drag draws a rectangle of the viewport; Escape or a bare click cancels. */
export function selectRegion({
  host,
  onDraw,
}: {
  host: Window;
  onDraw: (box: Box) => void;
}): Promise<Box | undefined> {
  const doc = host.document;
  const controller = new AbortController();
  const listen = { capture: true, signal: controller.signal };
  let start: { x: number; y: number } | undefined;
  let box: Box | undefined;
  return new Promise((resolve) => {
    const finish = (result: Box | undefined) => {
      controller.abort();
      resolve(result);
    };
    for (const type of SWALLOWED) doc.addEventListener(type, swallow, listen);
    doc.addEventListener(
      "pointerdown",
      (event) => {
        start = { x: event.clientX, y: event.clientY };
      },
      listen,
    );
    doc.addEventListener(
      "pointermove",
      (event) => {
        if (!start) return;
        box = {
          x: Math.min(start.x, event.clientX),
          y: Math.min(start.y, event.clientY),
          width: Math.abs(event.clientX - start.x),
          height: Math.abs(event.clientY - start.y),
        };
        onDraw(box);
      },
      listen,
    );
    doc.addEventListener(
      "pointerup",
      () => finish(box && box.width > 4 && box.height > 4 ? box : undefined),
      listen,
    );
    doc.addEventListener("keydown", (event) => event.key === "Escape" && finish(undefined), listen);
  });
}
