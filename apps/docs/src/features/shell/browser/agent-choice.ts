const LAUNCHER = ".docs-agent-launcher";
const motion = matchMedia("(prefers-reduced-motion: no-preference)");
let chosen = "claude";
let manual = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function show(text = chosen) {
  document.querySelectorAll<HTMLElement>(LAUNCHER).forEach((launcher) => {
    const select = launcher.querySelector("select");
    const name = launcher.querySelector(".docs-agent-name");
    if (select) select.value = chosen;
    if (name) name.textContent = text;
  });
}

function busy() {
  return (
    document.hidden ||
    Boolean(document.querySelector(`${LAUNCHER}:hover, ${LAUNCHER}:focus-within`))
  );
}

function typeName(length = 0) {
  if (manual || !motion.matches || busy()) {
    show();
    schedule();
    return;
  }
  show(chosen.slice(0, length));
  timer = setTimeout(() => {
    if (length < chosen.length) typeName(length + 1);
    else schedule();
  }, 85);
}

function schedule() {
  clearTimeout(timer);
  if (manual || !motion.matches) return;
  timer = setTimeout(() => {
    const select = document.querySelector<HTMLSelectElement>(`${LAUNCHER} select`);
    if (!select || busy()) return schedule();
    const options = [...select.options].map((option) => option.value);
    chosen = options[(options.indexOf(chosen) + 1) % options.length] ?? chosen;
    typeName();
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
