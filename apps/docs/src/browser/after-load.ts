/* The build leaves a poster only on a first-screen video and marks the hero image high priority,
   so these are the first screen's pictures. Decoded, their paint is at most a frame away. */
const FIRST_SCREEN = "video[poster],img[fetchpriority=high]";

function firstScreenDecoded() {
  const shown = document.querySelectorAll<HTMLImageElement | HTMLVideoElement>(FIRST_SCREEN);
  const decoded = Promise.all(
    [...shown].map((element) => {
      const image = new Image();
      image.src = element instanceof HTMLVideoElement ? element.poster : element.currentSrc;
      return image.decode().catch(() => {});
    }),
  );
  /* A stalled picture must not hold the sheet back for good. */
  return Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

/**
 * Runs `run` once the window has loaded, the first screen's images and posters are decoded and a
 * frame has drawn them: a frame callback runs just before the paint, and a task queued from it
 * runs after. The shared stylesheet waits this way so it never competes with the first screen.
 */
export function afterLoad(run: () => void) {
  const start = () =>
    void firstScreenDecoded().then(() => requestAnimationFrame(() => setTimeout(run, 0)));
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
