import type { Box } from "./feedback";

const place = ({ element, box }: { element: HTMLElement; box: Box }) => {
  Object.assign(element.style, {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
};

const boxOf = ({ element }: { element: Element }): Box => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

const swallow = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};

/** Hover highlights an element, a click picks it, Escape cancels; the page never sees them. */
export function pickElement({
  host,
  layer,
  isOwn,
}: {
  host: Window;
  layer: HTMLElement;
  isOwn: (element: Element) => boolean;
}): Promise<Element | undefined> {
  const doc = host.document;
  const highlight = doc.createElement("div");
  highlight.className = "highlight";
  layer.append(highlight);
  const controller = new AbortController();
  const listen = { capture: true, signal: controller.signal };
  const under = (event: MouseEvent) => {
    const element = doc.elementFromPoint(event.clientX, event.clientY);
    return element && !isOwn(element) ? element : undefined;
  };
  return new Promise((resolve) => {
    const finish = (element: Element | undefined) => {
      controller.abort();
      highlight.remove();
      resolve(element);
    };
    doc.addEventListener(
      "mousemove",
      (event) => {
        const element = under(event);
        if (element) place({ element: highlight, box: boxOf({ element }) });
      },
      listen,
    );
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"] as const) {
      doc.addEventListener(type, swallow, listen);
    }
    doc.addEventListener(
      "click",
      (event) => {
        swallow(event);
        finish(under(event));
      },
      listen,
    );
    doc.addEventListener("keydown", (event) => event.key === "Escape" && finish(undefined), listen);
  });
}

/** A drag draws a rectangle of the viewport; Escape or a bare click cancels. */
export function selectRegion({
  host,
  layer,
}: {
  host: Window;
  layer: HTMLElement;
}): Promise<Box | undefined> {
  const doc = host.document;
  const sheet = doc.createElement("div");
  sheet.className = "sheet";
  const outline = doc.createElement("div");
  outline.className = "highlight";
  sheet.append(outline);
  layer.append(sheet);
  const controller = new AbortController();
  const { signal } = controller;
  let start: { x: number; y: number } | undefined;
  let box: Box | undefined;
  return new Promise((resolve) => {
    const finish = (result: Box | undefined) => {
      controller.abort();
      sheet.remove();
      resolve(result);
    };
    sheet.addEventListener(
      "pointerdown",
      (event) => {
        start = { x: event.clientX, y: event.clientY };
      },
      { signal },
    );
    sheet.addEventListener(
      "pointermove",
      (event) => {
        if (!start) return;
        box = {
          x: Math.min(start.x, event.clientX),
          y: Math.min(start.y, event.clientY),
          width: Math.abs(event.clientX - start.x),
          height: Math.abs(event.clientY - start.y),
        };
        place({ element: outline, box });
      },
      { signal },
    );
    sheet.addEventListener(
      "pointerup",
      () => finish(box && box.width > 2 && box.height > 2 ? box : undefined),
      {
        signal,
      },
    );
    doc.addEventListener("keydown", (event) => event.key === "Escape" && finish(undefined), {
      capture: true,
      signal,
    });
  });
}
