const get = (id) => document.getElementById(id);
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = was;
    }, 1200);
  } catch {
    get("ui-notice").textContent = "Clipboard unavailable. Select the value to copy it.";
  }
});
const search = get("tenant-search");
if (search)
  search.addEventListener("input", () => {
    let count = 0;
    for (const card of document.querySelectorAll("[data-tenant]")) {
      card.hidden = !card.textContent.toLowerCase().includes(search.value.toLowerCase());
      if (!card.hidden) count++;
    }
    get("tenant-count").textContent = count + " providers";
    get("tenant-empty").hidden = count !== 0;
  });

const feed = get("activity");
const status = get("activity-status");
const filter = get("activity-search");
const outcome = get("activity-outcome");
let events = [];
let paused = false;
let request = null;
let updated = "";
let signature = "";
function activityRow(event) {
  const row = document.createElement("tr");
  const values = [
    new Date(event.at).toLocaleTimeString(),
    event.outcome,
    event.kind,
    event.detail + (event.subject || event.client ? " · " + (event.subject || event.client) : ""),
  ];
  for (const [index, value] of values.entries()) {
    const cell = document.createElement("td");
    cell.textContent = value;
    cell.className = index === 3 ? "activity-detail" : "mono";
    if (index === 1) cell.className = event.outcome === "ok" ? "ok" : "refused";
    row.append(cell);
  }
  return row;
}

function render() {
  const needle = filter.value.toLowerCase();
  const visible = events.filter(
    (event) =>
      (!outcome.value || event.outcome === outcome.value) &&
      [event.kind, event.detail, event.subject, event.client]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  status.textContent =
    (paused ? "Paused" : "Live") +
    " · " +
    visible.length +
    " events" +
    (updated ? " · updated " + updated : "");
  const next = JSON.stringify(visible);
  if (next === signature) return;
  const selection = String(window.getSelection());
  if (selection) return;
  signature = next;
  feed.replaceChildren(...visible.map(activityRow));
  if (!visible.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty";
    cell.textContent = events.length
      ? "No events match these filters."
      : "No activity yet. Start a login from your app to see the requests here.";
    row.append(cell);
    feed.append(row);
  }
}
async function poll() {
  if (paused || document.hidden || request) return;
  const controller = new AbortController();
  request = controller;
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(feed.dataset.src, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (request !== controller) return;
    events = data.events || [];
    updated = new Date().toLocaleTimeString();
    render();
  } catch (error) {
    if (request === controller)
      status.textContent = "Activity unavailable (" + error.message + "). Retrying…";
  } finally {
    clearTimeout(timeout);
    if (request === controller) request = null;
  }
}
if (feed) {
  filter.addEventListener("input", render);
  outcome.addEventListener("change", render);
  get("activity-pause").addEventListener("click", () => {
    paused = !paused;
    if (paused && request) {
      request.abort();
      request = null;
    }
    get("activity-pause").textContent = paused ? "Resume" : "Pause";
    get("activity-pause").setAttribute("aria-pressed", String(paused));
    render();
    if (!paused) void poll();
  });
  document.addEventListener("visibilitychange", poll);
  void poll();
  setInterval(poll, 2000);
}
