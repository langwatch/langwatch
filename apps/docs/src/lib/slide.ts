/** Shows or hides a panel with a 200ms height and fade; a reversal starts from where it is. */
export function slide({ panel, open }: { panel: HTMLElement; open: boolean }) {
  const all = panel.getAnimations();
  const running = all.filter((animation) => animation.id === "docs-slide");
  const from = { height: `${panel.offsetHeight}px`, opacity: getComputedStyle(panel).opacity };
  all.forEach((animation) => animation.cancel());
  panel.hidden = false;
  if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    panel.hidden = !open;
    return;
  }
  const shut = { height: "0px", opacity: 0, overflow: "hidden" };
  const shown = { height: `${panel.scrollHeight}px`, opacity: 1, overflow: "hidden" };
  const [rest, end] = open ? [shut, shown] : [shown, shut];
  const start = running.length ? { ...from, overflow: "hidden" } : rest;
  const animation = panel.animate([start, end], {
    duration: 200,
    easing: "ease-out",
    fill: "forwards",
    id: "docs-slide",
  });
  animation.onfinish = () => {
    panel.hidden = !open;
    animation.cancel();
  };
}
