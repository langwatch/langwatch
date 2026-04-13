const STORAGE_KEY = "lw_rbac_debug";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function executeInTab(fn) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fn,
    args: [STORAGE_KEY],
  });
  return results?.[0]?.result;
}

async function readState() {
  return executeInTab((key) => localStorage.getItem(key));
}

async function setState(enabled) {
  return executeInTab(
    enabled
      ? (key) => { localStorage.setItem(key, "1"); location.reload(); }
      : (key) => { localStorage.removeItem(key); location.reload(); }
  );
}

function updateUI(enabled) {
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("status-text");
  dot.className = "status-dot" + (enabled ? " enabled" : "");
  statusText.textContent = enabled ? "Panel is enabled" : "Panel is disabled";
}

async function init() {
  const tab = await getActiveTab();

  // Hide controls if not on a LangWatch-looking page
  // (best-effort heuristic — just check for localhost or known domains)
  const url = tab?.url ?? "";
  const isLangWatch =
    url.includes("localhost") ||
    url.includes("langwatch.ai") ||
    url.includes("app.langwatch");

  if (!isLangWatch) {
    document.getElementById("main-content").style.display = "none";
    document.getElementById("not-langwatch").style.display = "block";
    document.getElementById("status-text").textContent = "Not a LangWatch page";
    return;
  }

  try {
    const current = await readState();
    updateUI(current === "1");
  } catch {
    document.getElementById("status-text").textContent = "Could not read page state";
  }

  document.getElementById("btn-enable").addEventListener("click", async () => {
    await setState(true);
    window.close();
  });

  document.getElementById("btn-disable").addEventListener("click", async () => {
    await setState(false);
    window.close();
  });
}

init();
