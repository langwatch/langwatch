const get = (id) => document.getElementById(id);
const notice = get("notice");
get("host").textContent = location.host;
const inbox = get("messages");
const search = get("search");
let messages = [];
let busy = false;
let loaded = false;
let signature = "";
let recipient = "";
let recipientSignature = "";
// Desktop notifications. The inbox is a tab you leave open in the background
// while you work in the application that sends the mail, so the useful moment
// to be told about a message is exactly the moment this tab cannot show you
// one. Off until asked for: a page that demands notification permission on
// load is a page people deny permanently.
const NOTIFY_KEY = "mailsim:notify";
const notifyButton = get("notify");
let notifying = false;
let known = null;

function setNotifying(on) {
  notifying = on;
  if (notifyButton) {
    notifyButton.setAttribute("aria-pressed", String(on));
    notifyButton.textContent = on ? "Notifying" : "Notify me";
  }
  try {
    localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
  } catch {
    // A browser refusing storage still notifies for this session.
  }
}

// announce fires one notification per message that arrived since the last poll.
// The first poll only records what is already there — a page opened on a full
// inbox must not fire twelve notifications for mail that arrived yesterday.
function announce(list) {
  const ids = new Set(list.map((message) => message.id));
  if (known === null) {
    known = ids;
    return;
  }
  const fresh = list.filter((message) => !known.has(message.id));
  known = ids;
  if (!notifying || Notification.permission !== "granted") return;
  for (const message of fresh.slice(0, 3)) {
    const note = new Notification(message.subject || "(no subject)", {
      body: "To " + message.to.join(", "),
      tag: message.id,
    });
    note.addEventListener("click", () => {
      window.focus();
      location.assign("/messages/" + encodeURIComponent(message.id));
    });
  }
  if (fresh.length > 3) {
    new Notification(fresh.length + " messages arrived", { tag: "mailsim:batch" });
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    ...options,
  });
  if (!response.ok) throw new Error("Request failed (" + response.status + "). Please retry.");
  return response.status === 204 ? null : response.json();
}

function render() {
  if (!loaded) return;
  const query = search.value.toLowerCase();
  const filtered = messages.filter(
    (message) =>
      (!recipient || message.to.some((address) => address.toLowerCase() === recipient)) &&
      [message.from, ...message.to, message.subject].join(" ").toLowerCase().includes(query),
  );
  get("count").textContent =
    filtered.length + (query || recipient ? " of " + messages.length : "") + " messages";
  get("empty").hidden = filtered.length > 0;
  get("empty").textContent =
    query || recipient
      ? "No messages match this search."
      : "No messages yet. Trigger an invite or sign-in email in your app and it will appear here.";
  get("clear").disabled = messages.length === 0;
  const next = JSON.stringify(filtered);
  if (next === signature) return;
  if (inbox.contains(document.activeElement)) return;
  const selection = String(window.getSelection());
  if (selection) return;
  signature = next;
  inbox.replaceChildren(
    ...filtered.map((message) => {
      const row = document.createElement("tr");
      row.dataset.message = message.id;
      const first = document.createElement("td");
      const link = document.createElement("a");
      link.href = "/messages/" + encodeURIComponent(message.id);
      link.className = "subject";
      link.textContent = message.subject || "(no subject)";
      const sender = document.createElement("div");
      sender.className = "secondary";
      sender.textContent = message.from;
      first.append(link, sender);
      row.append(first);
      for (const text of [
        message.to.join(", "),
        new Date(message.receivedAt).toLocaleString(),
        new Intl.NumberFormat().format(message.sizeBytes) + " B",
      ]) {
        const cell = document.createElement("td");
        cell.className = "mono";
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    }),
  );
}

async function refresh() {
  // A hidden tab normally stops polling, because nobody is looking at it. With
  // notifications on somebody is waiting on it, so it keeps going — that is the
  // whole of what "notify me" buys.
  if (!inbox || busy || (document.hidden && !notifying)) return;
  busy = true;
  try {
    messages = (await api("/api/messages")).messages;
    loaded = true;
    announce(messages);
    renderRecipients();
    render();
    get("live-status").textContent = "Live · " + new Date().toLocaleTimeString();
  } catch (error) {
    get("live-status").textContent = "Disconnected · retrying";
    notice.textContent = error.message;
  } finally {
    busy = false;
  }
}

function renderRecipients() {
  const counts = new Map();
  for (const message of messages) {
    for (const address of new Set(message.to.map((value) => value.toLowerCase()))) {
      counts.set(address, (counts.get(address) || 0) + 1);
    }
  }
  const addresses = [...counts].toSorted(([a], [b]) => a.localeCompare(b));
  const next = JSON.stringify([addresses, recipient]);
  if (next === recipientSignature) return;
  recipientSignature = next;
  const focused = document.activeElement?.dataset.recipient;
  get("recipient-count").textContent = "· " + addresses.length;
  get("all-recipients").setAttribute("aria-pressed", String(!recipient));
  const nodes = addresses.map(([address, count]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.recipient = address;
    button.setAttribute("aria-pressed", String(address === recipient));
    button.textContent = address + " · " + count;
    button.addEventListener("click", () => {
      recipient = address;
      renderRecipients();
      render();
    });
    return button;
  });
  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "secondary";
    empty.textContent = "No addresses yet. They appear when this stack sends mail.";
    nodes.push(empty);
  }
  get("recipients").replaceChildren(...nodes);
  if (focused) nodes.find((node) => node.dataset.recipient === focused)?.focus();
}

if (inbox) {
  get("all-recipients").addEventListener("click", () => {
    recipient = "";
    renderRecipients();
    render();
  });
  search.addEventListener("input", render);
  get("refresh").addEventListener("click", refresh);
  if (notifyButton) {
    if (!("Notification" in window)) {
      notifyButton.disabled = true;
      notifyButton.title = "This browser does not offer desktop notifications.";
    } else {
      let remembered = "0";
      try {
        remembered = localStorage.getItem(NOTIFY_KEY) || "0";
      } catch {
        // Storage refused; the toggle simply starts off.
      }
      setNotifying(remembered === "1" && Notification.permission === "granted");
      notifyButton.addEventListener("click", async () => {
        if (notifying) {
          setNotifying(false);
          notice.textContent = "Desktop notifications off.";
          return;
        }
        const permission =
          Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();
        if (permission !== "granted") {
          notice.textContent =
            "Your browser is blocking notifications for this site. Allow them in its site settings to turn this on.";
          return;
        }
        setNotifying(true);
        notice.textContent =
          "You will be told when a message arrives, even with this tab in the background.";
      });
    }
  }
  get("clear").addEventListener("click", async () => {
    if (!confirm("Clear all caught messages from this stack?")) return;
    get("clear").disabled = true;
    try {
      await api("/api/messages", { method: "DELETE" });
      notice.textContent = "Inbox cleared.";
      await refresh();
    } catch (error) {
      notice.textContent = error.message;
      get("clear").disabled = false;
    }
  });
  void refresh();
  setInterval(refresh, 2000);
  document.addEventListener("visibilitychange", refresh);
}

function selectView(tab) {
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    get(button.dataset.view).hidden = !active;
  }
}
const tabs = Array.from(document.querySelectorAll("[data-view]"));
if (tabs.length) selectView(tabs.find((tab) => tab.getAttribute("aria-selected") === "true"));
for (const tab of tabs) {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    let next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    selectView(tabs[next]);
    tabs[next].focus();
  });
}
document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) selectView(tab);
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      notice.textContent = "Copied.";
    } catch {
      notice.textContent = "Clipboard unavailable. Select the link to copy it.";
    }
  }
  const button = event.target.closest("[data-delete]");
  if (button && confirm("Delete this caught message?")) {
    button.disabled = true;
    try {
      await api("/api/messages/" + encodeURIComponent(button.dataset.delete), { method: "DELETE" });
      location.assign("/");
    } catch (error) {
      notice.textContent = error.message;
      button.disabled = false;
    }
  }
});
