/**
 * Runs `run` once the page has loaded and drawn a frame: a frame callback runs just before the
 * paint, and a task queued from it runs after. Work deferred this way (the shared stylesheet,
 * idle islands) never competes with the first paint, however late a slow device draws it.
 */
export function afterFirstPaint(run: () => void) {
  const start = () => requestAnimationFrame(() => setTimeout(run, 0));
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
