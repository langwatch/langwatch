import {
  agentAt,
  approach,
  casinoName,
  CODING_AGENTS,
  flickVelocity,
  nameOpacity,
  reelOffset,
  restingSlot,
  WHEEL,
  wheelOffset,
} from "../model/agent-wheel.ts";

const LAUNCHER = ".docs-agent-launcher";
const PICK = ".docs-agent-pick[data-reel]";
const motion = matchMedia("(prefers-reduced-motion: no-preference)");
let chosen = "claude";
let manual = false;
let timer: ReturnType<typeof setTimeout> | undefined;

type Reel = {
  pick: HTMLElement;
  names: HTMLElement[];
  slots: number[];
  position: number;
  goal: number;
  tau: number;
  speed: number;
  target?: number;
  frame: number;
  last: number;
};
type Drag = {
  id: number;
  startY: number;
  from: number;
  moved: boolean;
  samples: { time: number; y: number }[];
};
let reel: Reel | undefined;
let drag: Drag | undefined;
let wheeling: ReturnType<typeof setTimeout> | undefined;

/* Turns the wheel to the chosen agent; a name wrapping round the back jumps without sweeping. */
function show() {
  const current = CODING_AGENTS.indexOf(chosen);
  document.querySelectorAll<HTMLElement>(LAUNCHER).forEach((launcher) => {
    const select = launcher.querySelector("select");
    if (select) select.value = chosen;
    launcher.querySelector(".docs-agent-pick")?.toggleAttribute("data-reel", true);
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

function choose({ pick, agent }: { pick: HTMLElement; agent: string }) {
  const select = pick.querySelector("select");
  if (!select) return;
  select.value = agent;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/* Draws the turning reel; a slot coming round the back may carry a casino name on a fast spin. */
function draw({ turning }: { turning: Reel }) {
  turning.names.forEach((name, index) => {
    const offset = reelOffset({ index, position: turning.position });
    const slot = Math.round(turning.position + offset);
    if (slot !== turning.slots[index]) {
      turning.slots[index] = slot;
      const casino =
        turning.target === undefined
          ? undefined
          : casinoName({ slot, speed: turning.speed, target: turning.target });
      if (casino) name.dataset.casino = casino;
      else delete name.dataset.casino;
    }
    name.style.transform = `translateY(${offset * WHEEL.stepPx}px)`;
    name.style.opacity = String(nameOpacity({ distance: offset }));
  });
}

function settle({ turning }: { turning: Reel }) {
  reel = undefined;
  choose({ pick: turning.pick, agent: agentAt({ slot: turning.goal }) });
  for (const name of turning.names) {
    name.style.removeProperty("transform");
    name.style.removeProperty("opacity");
    delete name.dataset.casino;
  }
  turning.pick.querySelector(".docs-agent-wheel")?.removeAttribute("data-live");
}

function frame(now: number) {
  const turning = reel;
  if (!turning) return;
  const seconds = Math.min((now - turning.last) / 1000, 0.05);
  turning.last = now;
  if (!drag && seconds > 0) {
    const before = turning.position;
    turning.position = approach({ ...turning, seconds });
    turning.speed = (turning.position - before) / seconds;
  }
  draw({ turning });
  const still = turning.position === turning.goal && Number.isInteger(turning.goal);
  if (!drag && !wheeling && still) return settle({ turning });
  turning.frame = requestAnimationFrame(frame);
}

function run({ turning }: { turning: Reel }) {
  if (turning.frame) return;
  turning.last = performance.now();
  turning.frame = requestAnimationFrame(frame);
}

/** Takes hold of a launcher's reel, catching it where it is if it is already turning. */
function grab({ pick }: { pick: HTMLElement }) {
  manual = true;
  clearTimeout(timer);
  if (reel?.pick === pick) return reel;
  if (reel) {
    cancelAnimationFrame(reel.frame);
    settle({ turning: reel });
  }
  const position = Math.max(CODING_AGENTS.indexOf(chosen), 0);
  const order = (name: HTMLElement) => CODING_AGENTS.indexOf(name.dataset.agent ?? "");
  const names = [...pick.querySelectorAll<HTMLElement>(".docs-agent-name")].toSorted(
    (a, b) => order(a) - order(b),
  );
  const slots = names.map((_, index) => Math.round(position + reelOffset({ index, position })));
  pick.querySelector(".docs-agent-wheel")?.toggleAttribute("data-live", true);
  reel = {
    pick,
    names,
    slots,
    position,
    goal: position,
    tau: WHEEL.snapTau,
    speed: 0,
    frame: 0,
    last: 0,
  };
  return reel;
}

function turnTo({
  pick,
  slot,
  tau = WHEEL.snapTau,
}: {
  pick: HTMLElement;
  slot: number;
  tau?: number;
}) {
  if (!motion.matches) return choose({ pick, agent: agentAt({ slot }) });
  const turning = grab({ pick });
  Object.assign(turning, { goal: slot, tau, target: tau === WHEEL.spinTau ? slot : undefined });
  turning.names.forEach((name, index) => {
    if (Math.abs((turning.slots[index] ?? 0) - slot) <= 2) delete name.dataset.casino;
  });
  run({ turning });
}

function release({ event, pick }: { event: PointerEvent; pick: HTMLElement }) {
  const held = drag;
  drag = undefined;
  delete pick.dataset.dragging;
  if (!held) return;
  const current = reel?.pick === pick ? reel.position : CODING_AGENTS.indexOf(chosen);
  const dy = event.clientY - held.startY;
  if (!held.moved) {
    if (event.type === "pointercancel") return turnTo({ pick, slot: Math.round(current) });
    const centre = (pick.querySelector(".docs-agent-wheel")?.getBoundingClientRect().top ?? 0) + 10;
    const steps = Math.max(-2, Math.min(2, Math.round((event.clientY - centre) / WHEEL.stepPx)));
    if (steps !== 0) return turnTo({ pick, slot: Math.round(current) + steps });
    if (reel?.pick === pick) return turnTo({ pick, slot: Math.round(current) });
    const select = pick.querySelector("select");
    try {
      select?.showPicker();
    } catch {
      /* Without a picker the focused select still takes the arrow keys. */
    }
    return;
  }
  if (!motion.matches) return turnTo({ pick, slot: current - Math.sign(dy) });
  held.samples.push({ time: event.timeStamp, y: event.clientY });
  const velocity = flickVelocity({ samples: held.samples });
  const spun = Math.abs(velocity) >= WHEEL.flickSpeed;
  turnTo({
    pick,
    slot: restingSlot({ position: current, velocity }),
    tau: spun ? WHEEL.spinTau : WHEEL.snapTau,
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
    if (!select || busy() || reel) return schedule();
    const options = [...select.options].map((option) => option.value);
    chosen = options[(options.indexOf(chosen) + 1) % options.length] ?? chosen;
    show();
    schedule();
  }, 2800);
}

function onPointerDown(event: PointerEvent) {
  const pick = event.target instanceof Element ? event.target.closest<HTMLElement>(PICK) : null;
  if (!pick || event.button !== 0) return;
  event.preventDefault();
  pick.querySelector("select")?.focus({ preventScroll: true });
  pick.setPointerCapture(event.pointerId);
  const from = motion.matches ? grab({ pick }).position : CODING_AGENTS.indexOf(chosen);
  if (reel) Object.assign(reel, { goal: from, target: undefined });
  const sample = { time: event.timeStamp, y: event.clientY };
  drag = { id: event.pointerId, startY: event.clientY, from, moved: false, samples: [sample] };
}

function onPointerMove(event: PointerEvent) {
  const pick = event.target instanceof Element ? event.target.closest<HTMLElement>(PICK) : null;
  if (!pick || drag?.id !== event.pointerId) return;
  const dy = event.clientY - drag.startY;
  if (Math.abs(dy) > 4) drag.moved = true;
  drag.samples = [...drag.samples, { time: event.timeStamp, y: event.clientY }].slice(-12);
  if (!drag.moved || !reel) return;
  pick.dataset.dragging = "";
  reel.position = drag.from - dy / WHEEL.stepPx;
  run({ turning: reel });
}

function onPointerEnd(event: Event) {
  const pick = event.target instanceof Element ? event.target.closest<HTMLElement>(PICK) : null;
  if (pick && event instanceof PointerEvent && drag?.id === event.pointerId)
    release({ event, pick });
}

function onWheel(event: WheelEvent) {
  const pick = event.target instanceof Element ? event.target.closest<HTMLElement>(PICK) : null;
  if (!pick || drag) return;
  event.preventDefault();
  const lines = [1, 33, 100][event.deltaMode] ?? 1;
  const step = (event.deltaY * lines) / 100;
  const gesture = wheeling;
  clearTimeout(wheeling);
  if (!motion.matches) {
    wheeling = setTimeout(() => (wheeling = undefined), 200);
    if (!gesture) turnTo({ pick, slot: CODING_AGENTS.indexOf(chosen) + Math.sign(step) });
    return;
  }
  const turning = grab({ pick });
  Object.assign(turning, { goal: turning.goal + step, tau: WHEEL.snapTau, target: undefined });
  wheeling = setTimeout(() => {
    wheeling = undefined;
    turning.goal = Math.round(turning.goal);
  }, 140);
  run({ turning });
}

function onChange(event: Event) {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !select.closest(LAUNCHER)) return;
  manual = true;
  clearTimeout(timer);
  chosen = select.value;
  show();
}

function onApproach(event: Event) {
  if (event.target instanceof Element && event.target.closest(LAUNCHER)) show();
}

function onNavigated() {
  if (reel) {
    cancelAnimationFrame(reel.frame);
    chosen = agentAt({ slot: reel.goal });
    reel = undefined;
  }
  show();
  schedule();
}

function onMotionChange() {
  clearTimeout(timer);
  show();
  schedule();
}

/** Wires the sidebar agent launcher: drag, wheel and select turn it; idle, it cycles. */
export function startAgentChoice() {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, onPointerEnd);
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("change", onChange);
  document.addEventListener("pointerover", onApproach);
  document.addEventListener("focusin", onApproach);
  document.addEventListener("docs:navigated", onNavigated);
  motion.addEventListener("change", onMotionChange);
  show();
  schedule();
}
