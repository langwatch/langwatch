import { domToCanvas } from "modern-screenshot";

import type { Subject } from "./feedback";

/** The longest side a capture keeps, so one note stays well under haven's body limit. */
export const CAPTURE_MAX_SIDE = 1280;

/** A PNG data URL of what the reader pointed at, without the orb; undefined when the page
 * refuses. */
export async function captureSubject({
  host,
  subject,
  exclude,
}: {
  host: Window;
  subject: Subject;
  exclude: Element;
}): Promise<string | undefined> {
  const doc = host.document;
  const filter = (node: Node) => node !== exclude;
  const box = subject.kind === "element" ? subject.element.getBoundingClientRect() : subject.box;
  const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(box.width, box.height, 1));
  try {
    if (subject.kind === "element") {
      const canvas = await domToCanvas(subject.element, { scale, filter });
      return canvas.toDataURL("image/png");
    }
    const page = await domToCanvas(doc.documentElement, { scale, filter });
    const crop = doc.createElement("canvas");
    crop.width = Math.round(box.width * scale);
    crop.height = Math.round(box.height * scale);
    crop
      .getContext("2d")
      ?.drawImage(
        page,
        (box.x + host.scrollX) * scale,
        (box.y + host.scrollY) * scale,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    return crop.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
