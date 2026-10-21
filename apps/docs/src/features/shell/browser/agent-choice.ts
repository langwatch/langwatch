import { CODING_AGENTS, wheelOffset } from "../model/agent-wheel.ts";

const LAUNCHER = ".docs-agent-launcher";
const motion = matchMedia("(prefers-reduced-motion: no-preference)");
let chosen = "claude";
let manual = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/* Turns the wheel to the chosen agent; a name wrapping round the back jumps without sweeping. */
function show() {
  const current = CODING_AGENTS.indexOf(chosen);
  document.querySelectorAll<HTMLElement>(LAUNCHER).forEach((launcher) => {
    const select = launcher.querySelector("select");
    if (select) select.value = chosen;
    launcher.querySelectorAll<HTMLElement>(".docs-agent-name").forEach((name) => {
      const offset = wheelOffset({
        index: CODING_AGENTS.indexOf(name.dataset.agent ?? ""),
        chosen: current,
      });
      const before = Number(name.style.getPropertyValue("--docs-agent-offset") || offset);
      name.toggleAttribute("data-wrap", Math.abs(offset - before) > 1);
      name.style.setProperty("--docs-agent-offset", String(offset));
      name.dataset.distance = String(Math.abs(offset));
    });
  });
}

function busy() {
  return (
    document.hidden ||
    Boolean(document.querySelector(`${LAUNCHER}:hover, ${LAUNCHER}:focus-within`))
  );
}

function schedule() {
  clearTimeout(timer);
  if (manual || !motion.matches) return;
  timer = setTimeout(() => {
    const select = document.querySelector<HTMLSelectElement>(`${LAUNCHER} select`);
    if (!select || busy()) return schedule();
    const options = [...select.options].map((option) => option.value);
    chosen = options[(options.indexOf(chosen) + 1) % options.length] ?? chosen;
    show();
    schedule();
  }, 2800);
}

document.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !select.closest(LAUNCHER)) return;
  manual = true;
  clearTimeout(timer);
  chosen = select.value;
  show();
});
document.addEventListener("pointerover", (event) => {
  if (event.target instanceof Element && event.target.closest(LAUNCHER)) show();
});
document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element && event.target.closest(LAUNCHER)) show();
});
document.addEventListener("docs:navigated", () => {
  show();
  schedule();
});
motion.addEventListener("change", () => {
  clearTimeout(timer);
  show();
  schedule();
});
show();
schedule();
