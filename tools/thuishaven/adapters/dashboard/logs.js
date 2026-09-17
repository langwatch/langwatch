const get = (id) => document.getElementById(id);
const stack = get("log-stack");
const service = get("log-service");
const level = get("log-level");
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

function setFollowing(value) {
  following = value;
  get("log-follow").textContent = value ? "Following" : "Follow latest";
  get("log-follow").setAttribute("aria-pressed", String(value));
}

function logRow(line) {
  const row = document.createElement("div");
  row.className = "log-line";
  if (["warn", "error", "fatal"].includes(line.level)) row.classList.add("log-" + line.level);
  for (const [className, value] of [
    ["log-time", new Date(line.at).toLocaleTimeString()],
    ["log-service", line.service],
    ["log-message", line.text],
  ]) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = value;
    row.append(span);
  }
  return row;
}

function render() {
  const needle = search.value.toLowerCase();
  visible = lines.filter((line) => {
    const severity =
      !level.value ||
      ["error", "fatal"].includes(line.level) ||
      (level.value === "warn" && line.level === "warn");
    return severity && (line.service + " " + line.text).toLowerCase().includes(needle);
  });
  status.textContent =
    (paused ? "Paused" : "Live") +
    " · " +
    visible.length +
    " matching / " +
    lines.length +
    " recent lines" +
    (updated ? " · updated " + updated : "") +
    " · capture window: latest 1,000 lines";
  const signature = JSON.stringify(visible);
  if (signature === lastRender) return;
  const selection = String(window.getSelection());
  if (selection) return;
  lastRender = signature;
  const scroll = output.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const line of visible) fragment.append(logRow(line));
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
level.addEventListener("change", render);
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
document.addEventListener("visibilitychange", poll);
setInterval(poll, 2000);
