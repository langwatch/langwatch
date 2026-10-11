import { mountAmbientShader } from "@langwatch/design-system/ambient-ground-shader";

const motion = matchMedia("(prefers-reduced-motion: no-preference)");
let stop: (() => void) | null = null;
let generation = 0;
async function updateGround() {
  const version = ++generation;
  stop?.();
  stop = null;
  document.querySelector(".docs-ground-live")?.remove();
  if (!motion.matches || document.hidden) return;
  const ground = document.querySelector(".docs-ground");
  if (!ground) return;
  const layer = document.createElement("div");
  layer.className = "docs-ground-live";
  ground.append(layer);
  try {
    const dispose = await mountAmbientShader({
      element: layer,
      minPixelRatio: 0.5,
      maxPixelCount: 360_000,
      mode: document.documentElement.classList.contains("dark") ? "dark" : "light",
    });
    if (version !== generation) dispose();
    else stop = dispose;
  } catch {
    layer.remove();
  }
}
new MutationObserver(() => void updateGround()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});
motion.addEventListener("change", () => void updateGround());
document.addEventListener("visibilitychange", () => void updateGround());
void updateGround();
