/**
 * Starts the ambient ground's live shader in the boot splash and stops it when the splash
 * leaves. Built once as a classic script and inlined into the page by the boot-splash plugin,
 * so it runs before, and without, the app bundle. No WebGL or reduced motion: the static floor.
 */
import { mountAmbientShader } from "@langwatch/design-system/ambient-ground-shader";

/** A slow start keeps the splash, not a full-window render loop: after this, the still floor. */
const LIVE_FOR_MS = 4_000;
/** The shader's fade out in the boot-splash styles, with room to finish before it stops. */
const FADE_OUT_MS = 900;

async function runOn(element: HTMLElement): Promise<void> {
  const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
  let stop: () => void;
  try {
    stop = await mountAmbientShader({ element, mode, onSlow: () => delete element.dataset.live });
  } catch {
    return;
  }
  // The splash may have left while the texture loaded.
  if (!element.isConnected) return stop();
  let stopped = false;
  let fade: ReturnType<typeof setTimeout> | undefined;
  function stopOnce(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(settle);
    clearTimeout(fade);
    document.removeEventListener("visibilitychange", onHidden);
    document.removeEventListener("lw-boot:done", stopOnce);
    stop();
  }
  function settleToStill(): void {
    element.removeAttribute("data-live");
    fade = setTimeout(stopOnce, FADE_OUT_MS);
  }
  function onHidden(): void {
    if (document.visibilityState === "hidden") stopOnce();
  }
  element.dataset.live = "true";
  const settle = setTimeout(settleToStill, LIVE_FOR_MS);
  document.addEventListener("visibilitychange", onHidden);
  document.addEventListener("lw-boot:done", stopOnce, { once: true });
  onHidden();
}

function start(): void {
  const element = document.getElementById("lw-boot-shader");
  if (element && !matchMedia("(prefers-reduced-motion: reduce)").matches) void runOn(element);
}

start();
