/**
 * Runs `run` once the window has loaded (every image and poster too) and drawn a frame after it:
 * a frame callback runs just before the paint, and a task queued from it runs after. The shared
 * stylesheet waits this way so it never competes with the page's own bytes.
 */
export function afterLoad(run: () => void) {
  const start = () => requestAnimationFrame(() => setTimeout(run, 0));
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
