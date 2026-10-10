/**
 * Starts the ambient ground's live shader in the boot splash and stops it when the splash
 * leaves. Built once as a classic script and inlined into the page by the boot-splash plugin,
 * so it runs before, and without, the app bundle. No WebGL or reduced motion: the static floor.
 */
import { mountAmbientShader } from "@langwatch/design-system/ambient-ground-shader";

function start(): void {
  const element = document.getElementById("lw-boot-shader");
  if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
  let stop: () => void;
  try {
    stop = mountAmbientShader({ element, mode });
  } catch {
    return;
  }
  element.dataset.live = "true";
  document.addEventListener("lw-boot:done", () => stop(), { once: true });
}

start();
