const get = (id) => document.getElementById(id);
const stack = get("log-stack");
const service = get("log-service");
const levels = get("log-levels");
const search = get("log-search");
const output = get("log-output");
const status = get("log-status");
let lines = [];
let visible = [];
let paused = false;
let following = true;
let request = null;
let lastRender = "";
let updated = "";
// Severities switched off. Empty means everything shows, which is what a
// viewer opened to answer "what is happening" should start as.
const muted = new Set();
// severityOrder is worst first, so the chip you reach for in an incident is
// the one nearest the start of the row. Anything a service invents lands
// after these, in the order it first appeared.
const severityOrder = ["fatal", "error", "warn", "info", "debug", "trace"];

function severityRank(name) {
  const known = severityOrder.indexOf(name);
  return known === -1 ? severityOrder.length : known;
}

// levelCounts tallies everything loaded, not everything visible: a count that
// shrank as you filtered could not tell you what you had filtered out.
function levelCounts() {
  const counts = new Map();
  for (const line of lines)
    counts.set(line.level || "other", (counts.get(line.level || "other") || 0) + 1);
  return [...counts].toSorted(
    (a, b) => severityRank(a[0]) - severityRank(b[0]) || a[0].localeCompare(b[0]),
  );
}

function renderLevels() {
  const counts = levelCounts();
  const signature = JSON.stringify([counts, [...muted]]);
  if (levels.dataset.signature === signature) return;
  levels.dataset.signature = signature;
  if (!counts.length) {
    levels.replaceChildren();
    return;
  }
  levels.replaceChildren(
    ...counts.map(([name, count]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lv " + name;
      chip.dataset.level = name;
      chip.setAttribute("aria-pressed", String(!muted.has(name)));
      chip.append(name);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = new Intl.NumberFormat().format(count);
      chip.append(n);
      chip.addEventListener("click", () => {
        if (muted.has(name)) muted.delete(name);
        else muted.add(name);
        renderLevels();
        render();
      });
      return chip;
    }),
  );
}

// highlight writes the message into the row, marking each occurrence of the
// needle. It builds nodes rather than markup: a log line is whatever a service
// printed, and the one place it must never be treated as HTML is the page that
// shows it.
function highlight(span, text, needle) {
  if (!needle) {
    span.textContent = text;
    return;
  }
  const haystack = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      span.append(document.createTextNode(text.slice(from)));
      return;
    }
    span.append(document.createTextNode(text.slice(from, at)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + needle.length);
    span.append(mark);
    from = at + needle.length;
  }
}

function setFollowing(value) {
  following = value;
  get("log-follow").textContent = value ? "Following" : "Follow latest";
  get("log-follow").setAttribute("aria-pressed", String(value));
}

function logRow(line, needle) {
  const row = document.createElement("div");
  row.className = "log-line";
  if (["warn", "error", "fatal"].includes(line.level)) row.classList.add("log-" + line.level);
  const at = new Date(line.at);
  for (const [className, value] of [
    ["log-time", at.toLocaleTimeString()],
    ["log-service", line.service],
    ["log-message", line.text],
  ]) {
    const span = document.createElement("span");
    span.className = className;
    if (className === "log-message") highlight(span, value, needle);
    else span.textContent = value;
    // The clock alone cannot be lined up against a trace or another machine's
    // log; the whole timestamp can, and it costs a hover rather than a column.
    if (className === "log-time")
      span.title = at.toLocaleString() + " · " + (line.level || "no level");
    row.append(span);
  }
  return row;
}

function render() {
  const needle = search.value.toLowerCase();
  renderLevels();
  visible = lines.filter(
    (line) =>
      !muted.has(line.level || "other") &&
      (line.service + " " + line.text).toLowerCase().includes(needle),
  );
  renderStatus(needle);
  // The needle is part of the signature because it decides what is marked, not
  // only what is kept: two searches can select the same lines and highlight
  // different words in them.
  const signature = JSON.stringify([visible, needle]);
  if (signature === lastRender) return;
  const selection = String(window.getSelection());
  if (selection) return;
  lastRender = signature;
  const scroll = output.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const line of visible) fragment.append(logRow(line, needle));
  if (!visible.length)
    fragment.append(
      document.createTextNode(
        lines.length
          ? "No lines match these filters."
          : "No captured output yet. Logs appear when a service writes output.",
      ),
    );
  output.replaceChildren(fragment);
  output.scrollTop = following ? output.scrollHeight : scroll;
}

// renderStatus is the one line under the toolbar. It answers, in order: is it
// moving, how much of what is loaded am I looking at, how fresh is it, and how
// far back does it go — the four things asked of a log viewer that is filtered.
function renderStatus(needle) {
  const filtered = needle || muted.size;
  status.replaceChildren();
  const parts = [paused ? "Paused" : "Live"];
  parts.push(
    filtered
      ? visible.length.toLocaleString() + " of " + lines.length.toLocaleString() + " lines shown"
      : lines.length.toLocaleString() + " lines",
  );
  if (muted.size) parts.push("hiding " + [...muted].join(", "));
  if (updated) parts.push("updated " + updated);
  parts.push("latest 1,000 lines kept");
  for (const [index, part] of parts.entries()) {
    if (index) status.append(" · ");
    if (index >= 2) {
      status.append(part);
      continue;
    }
    const strong = document.createElement("b");
    strong.textContent = part;
    status.append(strong);
  }
}

function updateServices(names) {
  const current = service.value;
  const wanted = ["", ...names];
  const previous = JSON.stringify(Array.from(service.options, (option) => option.value));
  const next = JSON.stringify(wanted);
  if (previous === next) return;
  service.replaceChildren(...wanted.map((name) => new Option(name || "All services", name)));
  service.value = names.includes(current) ? current : "";
}

async function poll() {
  if (request || paused) return;
  if (document.hidden || !stack.value) return;
  const controller = new AbortController();
  request = controller;
  const query = new URLSearchParams({ stack: stack.value, service: service.value });
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/logs?" + query, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    if (request !== controller) return;
    lines = data.lines;
    updateServices(data.services);
    updated = new Date().toLocaleTimeString();
    render();
  } catch (error) {
    if (request === controller)
      status.textContent = "Could not refresh logs. " + error.message + " Retrying…";
  } finally {
    clearTimeout(timeout);
    if (request === controller) request = null;
  }
}

function changeSource(resetService) {
  if (request) request.abort();
  request = null;
  if (resetService) updateServices([]);
  lines = [];
  lastRender = "";
  updated = "";
  render();
  status.textContent = stack.value
    ? "Loading captured output…"
    : "Choose a stack to inspect its captured output.";
  void poll();
}

stack.addEventListener("change", () => changeSource(true));
service.addEventListener("change", () => changeSource(false));
search.addEventListener("input", render);
get("log-pause").addEventListener("click", () => {
  paused = !paused;
  if (paused && request) {
    request.abort();
    request = null;
  }
  get("log-pause").textContent = paused ? "Resume" : "Pause";
  get("log-pause").setAttribute("aria-pressed", String(paused));
  render();
  if (!paused) void poll();
});
get("log-follow").addEventListener("click", () => {
  setFollowing(!following);
  if (following) output.scrollTop = output.scrollHeight;
});
output.addEventListener("scroll", () => {
  if (output.scrollHeight - output.clientHeight - output.scrollTop > 24) setFollowing(false);
});
get("log-wrap").addEventListener("click", () => {
  get("log-wrap").setAttribute("aria-pressed", String(output.classList.toggle("wrap")));
});
const text = () =>
  visible.map((line) => line.at + " [" + line.service + "] " + line.text).join("\n");
get("log-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(text());
    status.textContent = "Visible log lines copied.";
  } catch {
    status.textContent = "Clipboard unavailable. Use Download to save these lines.";
  }
});
get("log-download").addEventListener("click", () => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text()], { type: "text/plain" }));
  link.href = url;
  link.download = (stack.value || "haven") + ".log";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-log-stack]");
  if (!button) return;
  const slug = button.dataset.logStack;
  const exists = Array.from(stack.options).some((option) => option.value === slug);
  if (!exists) stack.add(new Option(slug, slug));
  stack.value = slug;
  changeSource(true);
  get("logs").scrollIntoView({ block: "start" });
  search.focus({ preventScroll: true });
});
new MutationObserver(() => {
  const names = Array.from(
    document.querySelectorAll("[data-log-stack]"),
    (button) => button.dataset.logStack,
  );
  const selected = stack.value;
  stack.replaceChildren(
    new Option("Choose a stack", ""),
    ...names.map((name) => new Option(name, name)),
  );
  if (names.includes(selected)) stack.value = selected;
  else if (selected) changeSource(true);
}).observe(get("live"), { childList: true });
if (stack.options.length === 2) {
  stack.selectedIndex = 1;
  void poll();
}
// Slash focuses the filter and Escape clears it — the two keys every log
// viewer has, and without them filtering means reaching for the mouse each
// time the question changes.
document.addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    get("logs").scrollIntoView({ block: "start" });
    search.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && document.activeElement === search) {
    if (!search.value) {
      search.blur();
      return;
    }
    search.value = "";
    render();
  }
});

document.addEventListener("visibilitychange", poll);
setInterval(poll, 2000);
