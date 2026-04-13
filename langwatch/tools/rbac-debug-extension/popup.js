// ── Utilities ──────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function runInPage(fn, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: fn,
    args,
  }).then((r) => r?.[0]?.result ?? null);
}

// ── Page interactions ──────────────────────────────────────────────────────

function pageReadDebugContext() {
  return window.__lw_debug ?? null;
}

/** Fallback: fetch the user's first org via tRPC if __lw_debug.orgId is null */
function pageFetchFirstOrgId() {
  const input = encodeURIComponent(JSON.stringify({ "0": { json: { isDemo: false } } }));
  return fetch(
    `/api/trpc/organization.getAll?batch=1&input=${input}`,
    { credentials: "include" }
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const orgs = json?.[0]?.result?.data?.json;
      return Array.isArray(orgs) && orgs.length > 0 ? orgs[0].id : null;
    })
    .catch(() => null);
}

function pageFetchRbac(orgId) {
  const input = encodeURIComponent(
    JSON.stringify({ "0": { json: { organizationId: orgId } } })
  );
  return fetch(
    `/api/trpc/roleBinding.debugCurrentUser?batch=1&input=${input}`,
    { credentials: "include" }
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => json?.[0]?.result?.data?.json ?? null);
}

// ── Rendering helpers ──────────────────────────────────────────────────────

function roleBadge(role, customName) {
  const label = customName ?? role;
  const cls = {
    ADMIN: "badge-admin",
    MEMBER: "badge-member",
    VIEWER: "badge-viewer",
    CUSTOM: "badge-custom",
  }[role] ?? "badge-viewer";
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function scopeBadge(scopeType, scopeName, scopeId) {
  const icon = scopeType === "ORGANIZATION" ? "🏢" : scopeType === "TEAM" ? "👥" : "📁";
  const label = scopeName ?? (scopeId.slice(0, 8) + "…");
  return `<span class="badge badge-scope">${icon} ${esc(label)}</span>`;
}

function permsList(permissions, max = 5) {
  const visible = permissions.slice(0, max);
  const rest = permissions.length - max;
  const id = "pl-" + Math.random().toString(36).slice(2);
  const pills = visible.map((p) => `<span class="perm">${esc(p)}</span>`).join("");
  const more = rest > 0
    ? `<span class="perm-more" data-perms-id="${id}" onclick="togglePerms(this)">${rest} more…</span>`
    : "";
  const extras = permissions
    .slice(max)
    .map((p) => `<span class="perm perm-extra" data-perms-id="${id}" style="display:none">${esc(p)}</span>`)
    .join("");
  return `<div class="perms">${pills}${extras}${more}</div>`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bindingHTML(b, viaGroup) {
  return `
    <div class="binding${viaGroup ? " via-group" : ""}">
      <div class="binding-top">
        ${roleBadge(b.role, b.customRoleName)}
        <span style="font-size:10px;color:#666">on</span>
        ${scopeBadge(b.scopeType, b.scopeName, b.scopeId)}
        ${viaGroup ? `<span class="via-label">via ${esc(viaGroup)}</span>` : ""}
      </div>
      ${permsList(b.permissions)}
    </div>`;
}

function section(title, count, contentHTML, defaultOpen = true) {
  const id = `sec-${Math.random().toString(36).slice(2)}`;
  return `
    <div class="section">
      <div class="section-header" onclick="toggleSection('${id}')">
        <span class="section-title">${esc(title)}</span>
        ${count != null ? `<span class="section-count">${count}</span>` : ""}
        <span class="chevron" id="chev-${id}">${defaultOpen ? "▲" : "▼"}</span>
      </div>
      <div class="section-body${defaultOpen ? "" : " collapsed"}" id="${id}">
        ${contentHTML}
      </div>
    </div>`;
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderData(data, debugCtx) {
  const { user, groups, directBindings } = data;

  const userHTML = `
    <div class="user-card">
      <div class="user-name">${esc(user.name ?? "Unknown")}</div>
      <div class="user-email">${esc(user.email ?? "")}</div>
      <div class="user-role-row">
        <span class="label">Org role:</span>
        ${roleBadge(user.orgRole, null)}
      </div>
      ${permsList(user.orgRolePermissions, 4)}
    </div>`;

  const groupsHTML = groups.length === 0
    ? `<div class="empty-note">No group memberships</div>`
    : groups.map((g) => `
        <div class="group-card">
          <div class="group-name-row">
            <span class="group-name">👥 ${esc(g.name)}</span>
            ${g.scimSource ? `<span class="badge badge-scim">${esc(g.scimSource)}</span>` : ""}
          </div>
          ${g.bindings.length === 0
            ? `<div class="empty-note">No bindings on this group</div>`
            : `<div class="group-bindings">${g.bindings.map((b) => bindingHTML(b, g.name)).join("")}</div>`
          }
        </div>`
      ).join("");

  const directHTML = directBindings.length === 0
    ? `<div class="empty-note">No direct role bindings</div>`
    : directBindings.map((b) => bindingHTML(b, null)).join("");

  const allPerms = new Set(user.orgRolePermissions);
  for (const g of groups) for (const b of g.bindings) for (const p of b.permissions) allPerms.add(p);
  for (const b of directBindings) for (const p of b.permissions) allPerms.add(p);
  const sorted = [...allPerms].sort();

  const scopeLabel = debugCtx?.projectId
    ? "📁 current project"
    : debugCtx?.teamId
    ? "👥 current team"
    : "🏢 organisation";

  const effectiveHTML = `
    <div class="scope-context">Union of all bindings · scope: ${esc(scopeLabel)}</div>
    <div class="eff-perms" style="margin-top:6px">
      ${sorted.map((p) => `<span class="eff-perm">${esc(p)}</span>`).join("")}
    </div>`;

  return userHTML
    + section("Groups", groups.length, groupsHTML, groups.length > 0)
    + section("Direct Bindings", directBindings.length, directHTML, directBindings.length > 0)
    + section("Effective Permissions", sorted.length, effectiveHTML, true);
}

// ── Toggle helpers (called from inline onclick) ────────────────────────────

window.toggleSection = function (id) {
  const body = document.getElementById(id);
  const chev = document.getElementById(`chev-${id}`);
  if (!body) return;
  const collapsed = body.classList.toggle("collapsed");
  chev.textContent = collapsed ? "▼" : "▲";
};

window.togglePerms = function (el) {
  const id = el.dataset.permsId;
  const extras = document.querySelectorAll(`.perm-extra[data-perms-id="${id}"]`);
  const hidden = extras[0]?.style.display === "none";
  extras.forEach((e) => (e.style.display = hidden ? "" : "none"));
  el.textContent = hidden ? "show less" : `${extras.length} more…`;
};

// ── Main ───────────────────────────────────────────────────────────────────

let activeTabId = null;

async function init() {
  const tab = await getActiveTab();
  activeTabId = tab?.id;

  const url = tab?.url ?? "";
  const isLangWatch =
    url.includes("localhost") ||
    url.includes("langwatch.ai") ||
    url.includes("app.langwatch");

  if (!isLangWatch) {
    showError("Not on a LangWatch page.");
    document.getElementById("header-sub").textContent = "Not a LangWatch page";
    return;
  }

  const debugCtx = await runInPage(pageReadDebugContext);

  // Try __lw_debug first, fall back to fetching the first org
  let orgId = debugCtx?.orgId ?? null;
  if (!orgId) {
    orgId = await runInPage(pageFetchFirstOrgId);
  }

  if (!orgId) {
    showError("Could not determine organisation.\nAre you logged in to LangWatch?");
    document.getElementById("header-sub").textContent = "Not logged in";
    return;
  }

  document.getElementById("header-sub").textContent = "Loading…";

  let rbacData = null;
  try {
    rbacData = await runInPage(pageFetchRbac, [orgId]);
  } catch {
    showError("Failed to fetch RBAC data.");
    return;
  }

  if (!rbacData) {
    showError("API returned no data. Are you logged in?");
    return;
  }

  document.getElementById("header-sub").textContent =
    `${rbacData.user.name ?? rbacData.user.email ?? "Unknown"} · ${rbacData.user.orgRole}`;

  showData(renderData(rbacData, debugCtx));
}

function showError(msg) {
  document.getElementById("state-loading").style.display = "none";
  document.getElementById("state-error").style.display = "flex";
  document.getElementById("error-msg").textContent = msg;
}

function showData(html) {
  document.getElementById("state-loading").style.display = "none";
  const view = document.getElementById("data-view");
  view.innerHTML = html;
  view.style.display = "flex";
  view.style.flexDirection = "column";
  view.style.gap = "10px";
}

init();
