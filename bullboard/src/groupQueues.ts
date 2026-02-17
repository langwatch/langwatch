/**
 * Group Queue visibility routes for BullBoard.
 *
 * Receives the list of group-queue-eligible queue names from server.ts
 * (avoiding a redundant Redis scan) and exposes their staging state
 * via a JSON API and a self-contained HTML page.
 */

import { Hono } from "hono";
import type IORedis from "ioredis";
import { stripHashTag } from "./redisQueues";

/**
 * Lua script to atomically unblock a group.
 * Mirrors complete.lua: clears blocked + active state, recalculates
 * ready score so the dispatcher can pick the group up immediately.
 *
 * KEYS[1] = {queueName}:gq:blocked                 (set)
 * KEYS[2] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[3] = {queueName}:gq:group:{groupId}:jobs    (sorted set)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:signal                  (list)
 * ARGV[1] = groupId
 *
 * Returns: 1 = was blocked and unblocked, 0 = was not blocked
 */
const UNBLOCK_LUA = `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]
local jobsKey    = KEYS[3]
local readyKey   = KEYS[4]
local signalKey  = KEYS[5]
local groupId    = ARGV[1]

local wasBlocked = redis.call("SREM", blockedKey, groupId)
redis.call("DEL", activeKey)

local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  local score = math.sqrt(pendingCount)
  redis.call("ZADD", readyKey, score, groupId)
else
  redis.call("ZREM", readyKey, groupId)
end

redis.call("LPUSH", signalKey, "1")

return wasBlocked
`;

interface JobInfo {
  stagedJobId: string;
  dispatchAfter: number;
  data: Record<string, unknown> | null;
}

interface GroupInfo {
  groupId: string;
  pendingJobs: number;
  score: number;
  hasActiveJob: boolean;
  activeJobId: string | null;
  isBlocked: boolean;
  oldestJobMs: number | null;
  newestJobMs: number | null;
  jobs: JobInfo[];
}

interface QueueInfo {
  name: string;
  displayName: string;
  bullBoardUrl: string;
  pendingGroupCount: number;
  blockedGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  groups: GroupInfo[];
}

async function scanGroupQueues(
  redis: IORedis,
  groupQueueNames: string[],
): Promise<QueueInfo[]> {
  const queues: QueueInfo[] = [];

  for (const queueName of groupQueueNames) {
    const displayName = stripHashTag(queueName);
    const prefix = `${queueName}:gq:`;

    const readyKey = `${prefix}ready`;
    const blockedKey = `${prefix}blocked`;

    const [readyMembers, blockedMembers] = await Promise.all([
      redis.zrange(readyKey, 0, -1, "WITHSCORES"),
      redis.smembers(blockedKey),
    ]);

    const blockedSet = new Set(blockedMembers);

    // Parse ZRANGE WITHSCORES: [member1, score1, member2, score2, ...]
    const groupIds = new Set<string>();
    const readyScores = new Map<string, number>();
    for (let i = 0; i < readyMembers.length; i += 2) {
      const groupId = readyMembers[i]!;
      const score = parseFloat(readyMembers[i + 1]!);
      groupIds.add(groupId);
      readyScores.set(groupId, score);
    }

    for (const groupId of blockedMembers) {
      groupIds.add(groupId);
    }

    const groups: GroupInfo[] = [];
    for (const groupId of groupIds) {
      const jobsKey = `${prefix}group:${groupId}:jobs`;
      const activeKey = `${prefix}group:${groupId}:active`;
      const dataKey = `${prefix}group:${groupId}:data`;

      const [pendingJobs, activeJobId, jobsWithScores, jobDataHash] =
        await Promise.all([
          redis.zcard(jobsKey),
          redis.get(activeKey),
          redis.zrange(jobsKey, 0, -1, "WITHSCORES"),
          redis.hgetall(dataKey),
        ]);

      const jobs: JobInfo[] = [];
      for (let i = 0; i < jobsWithScores.length; i += 2) {
        const stagedJobId = jobsWithScores[i]!;
        const dispatchAfter = parseFloat(jobsWithScores[i + 1]!);

        let data: Record<string, unknown> | null = null;
        const rawData = jobDataHash[stagedJobId];
        if (rawData) {
          try {
            data = JSON.parse(rawData);
          } catch {
            data = null;
          }
        }
        jobs.push({ stagedJobId, dispatchAfter, data });
      }

      jobs.sort((a, b) => a.dispatchAfter - b.dispatchAfter);

      groups.push({
        groupId,
        pendingJobs,
        score: readyScores.get(groupId) ?? 0,
        hasActiveJob: activeJobId !== null,
        activeJobId,
        isBlocked: blockedSet.has(groupId),
        oldestJobMs: jobs.length > 0 ? jobs[0]!.dispatchAfter : null,
        newestJobMs:
          jobs.length > 0 ? jobs[jobs.length - 1]!.dispatchAfter : null,
        jobs,
      });
    }

    groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

    queues.push({
      name: queueName,
      displayName,
      bullBoardUrl: `/#/queue/${encodeURIComponent(displayName)}`,
      pendingGroupCount: groups.filter((g) => g.pendingJobs > 0).length,
      blockedGroupCount: groups.filter((g) => g.isBlocked).length,
      activeGroupCount: groups.filter((g) => g.hasActiveJob).length,
      totalPendingJobs: groups.reduce((sum, g) => sum + g.pendingJobs, 0),
      groups,
    });
  }

  queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return queues;
}

export function createGroupQueueRoutes(
  redis: IORedis,
  groupQueueNames: string[],
): Hono {
  const app = new Hono();

  app.get("/api/group-queues", async (c) => {
    const queues = await scanGroupQueues(redis, groupQueueNames);
    return c.json({ queues });
  });

  app.post("/api/group-queues/unblock", async (c) => {
    const body = await c.req.json<{ queueName: string; groupId: string }>();
    const { queueName, groupId } = body;

    if (!queueName || !groupId) {
      return c.json({ error: "queueName and groupId are required" }, 400);
    }

    if (!groupQueueNames.includes(queueName)) {
      return c.json({ error: "Unknown queue name" }, 404);
    }

    const prefix = `${queueName}:gq:`;

    // Atomic unblock: mirrors complete.lua logic
    // 1. Remove from blocked set
    // 2. Delete active key (stale lock from the failed job)
    // 3. Re-add to ready set if there are pending jobs (group may have
    //    been removed from ready during the original dispatch)
    // 4. Signal the dispatcher
    const unblockResult = await redis.eval(
      UNBLOCK_LUA,
      5,
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      groupId,
    );

    return c.json({
      ok: true,
      wasBlocked: unblockResult === 1,
    });
  });

  app.get("/groups", async (c) => {
    return c.html(groupsPageHtml());
  });

  return app;
}

// ---------------------------------------------------------------------------
// HTML page — uses imperative DOM patching instead of innerHTML replacement
// so the page doesn't flicker / jump on every 5-second refresh.
// ---------------------------------------------------------------------------

function groupsPageHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Group Queues - Bull Board</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 20px;
    }

    a { color: #7c83ff; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .header a { font-size: 14px; }
    h1 { font-size: 24px; font-weight: 600; }

    .status-bar {
      display: flex; gap: 8px; align-items: center;
      margin-left: auto; font-size: 13px; color: #888;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4caf50; display: inline-block;
    }
    .status-dot.error { background: #f44336; }

    /* Queue sections */
    .queue-section {
      background: #16213e; border-radius: 8px;
      margin-bottom: 16px; overflow: hidden;
      border: 1px solid #2a2a4a;
    }
    .queue-header {
      display: flex; align-items: center;
      padding: 14px 18px; cursor: pointer;
      user-select: none; gap: 12px;
    }
    .queue-header:hover { background: #1a2744; }

    .chevron { transition: transform 0.2s; color: #666; font-size: 12px; }
    .chevron.open { transform: rotate(90deg); }
    .queue-name { font-weight: 600; font-size: 15px; }
    .queue-link { font-size: 12px; margin-left: 4px; }
    .queue-badges { margin-left: auto; display: flex; gap: 6px; }

    .badge {
      display: inline-block; padding: 2px 10px;
      border-radius: 12px; font-size: 12px; font-weight: 600;
    }
    .badge-pending { background: #1e3a5f; color: #64b5f6; }
    .badge-blocked { background: #5f1e1e; color: #ef9a9a; }
    .badge-active  { background: #1e5f3a; color: #81c784; }
    .badge-jobs    { background: #2a2a4a; color: #aaa; }

    .queue-body { display: none; }
    .queue-body.open { display: block; }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left; padding: 8px 18px; background: #0f1b35;
      color: #888; font-weight: 500; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    th.r, td.r { text-align: right; }
    td { padding: 8px 18px; border-top: 1px solid #1e2a4a; vertical-align: top; }
    tr.blocked td { background: rgba(244,67,54,0.08); }

    .group-id { font-family: monospace; font-size: 12px; word-break: break-all; }

    .pill {
      display: inline-block; padding: 1px 8px;
      border-radius: 10px; font-size: 11px; font-weight: 600;
    }
    .pill-ok      { background: #1e5f3a; color: #81c784; }
    .pill-none    { background: #2a2a4a; color: #666; }
    .pill-blocked { background: #5f1e1e; color: #ef9a9a; }

    .btn-unblock {
      display: inline-block; margin-left: 8px; padding: 2px 10px;
      border-radius: 10px; font-size: 11px; font-weight: 600;
      background: #1e3a5f; color: #64b5f6; border: 1px solid #2a5a8f;
      cursor: pointer;
    }
    .btn-unblock:hover { background: #2a5a8f; }
    .btn-unblock:disabled { opacity: 0.5; cursor: default; }

    .time-ago { color: #888; font-size: 12px; white-space: nowrap; }
    .active-id {
      font-family: monospace; font-size: 11px; color: #81c784;
      max-width: 140px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }

    .empty-row td { text-align: center; color: #666; padding: 20px; }

    .show-more {
      padding: 8px 18px; color: #7c83ff;
      font-size: 13px; cursor: pointer;
      border-top: 1px solid #1e2a4a;
    }
    .show-more:hover { text-decoration: underline; }

    .payload-toggle { color: #7c83ff; cursor: pointer; font-size: 11px; }
    .payload-toggle:hover { text-decoration: underline; }

    .payload-box {
      margin-top: 6px; padding: 8px; background: #0f1b35;
      border-radius: 4px; font-family: monospace; font-size: 11px;
      color: #aaa; max-height: 300px; overflow: auto;
      white-space: pre-wrap; word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Group Queues</h1>
    <a href="/">&larr; Bull Board</a>
    <div class="status-bar">
      <span class="status-dot" id="statusDot"></span>
      <span id="statusText">Connecting...</span>
    </div>
  </div>
  <div id="content"></div>

<script>
(function () {
  // ---- state ----
  var closedSections  = {};   // queueName -> true
  var expandedQueues  = {};   // queueName -> true  (show all groups)
  var expandedPayloads = {};  // "queueName::groupId" -> true
  var DEFAULT_VISIBLE = 10;

  // ---- DOM refs keyed by id ----
  var queueEls  = {};  // queueName -> { section, chevron, badges:{jobs,pending,blocked,active}, body, tbody, showMore }
  var groupEls  = {};  // "queueName::groupId" -> { tr, pending, oldest, newest, activeCell, statusCell, statusPill, payloadCell }
  var container = document.getElementById("content");

  // ---- helpers ----
  function esc(s) {
    if (!s) return "";
    var d = document.createElement("span");
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(ms) {
    if (!ms) return "-";
    var diff = Date.now() - ms;
    if (diff < 0) {
      var a = -diff;
      if (a < 1000)    return "in <1s";
      if (a < 60000)   return "in " + Math.floor(a/1000) + "s";
      if (a < 3600000) return "in " + Math.floor(a/60000) + "m";
      return "in " + Math.floor(a/3600000) + "h";
    }
    if (diff < 1000)    return "<1s ago";
    if (diff < 60000)   return Math.floor(diff/1000) + "s ago";
    if (diff < 3600000) return Math.floor(diff/60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff/3600000) + "h ago";
    return Math.floor(diff/86400000) + "d ago";
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setAttr(el, attr, val) {
    if (el && el.getAttribute(attr) !== val) el.setAttribute(attr, val);
  }

  function formatJobs(jobs) {
    return jobs.map(function(j, i) {
      var hdr = "--- Job " + (i+1) + " [" + j.stagedJobId + "] dispatch: "
              + new Date(j.dispatchAfter).toISOString() + " ---";
      var body = j.data ? JSON.stringify(j.data, null, 2) : "(no data)";
      return hdr + "\\n" + body;
    }).join("\\n\\n");
  }

  // ---- toggle handlers (attached via data attributes) ----
  document.addEventListener("click", function(e) {
    var target = e.target;

    // queue header toggle
    var hdr = target.closest("[data-queue-toggle]");
    if (hdr) {
      var name = hdr.getAttribute("data-queue-toggle");
      closedSections[name] = !closedSections[name];
      updateQueueOpenState(name);
      return;
    }

    // show more / show less
    var sm = target.closest("[data-show-more]");
    if (sm) {
      var qn = sm.getAttribute("data-show-more");
      expandedQueues[qn] = !expandedQueues[qn];
      // need to re-render groups for this queue — simplest: remove group rows and rebuild
      rebuildGroups(qn, lastQueues[qn]);
      return;
    }

    // payload toggle
    var pt = target.closest("[data-payload-toggle]");
    if (pt) {
      var key = pt.getAttribute("data-payload-toggle");
      expandedPayloads[key] = !expandedPayloads[key];
      var box = pt.parentNode.querySelector(".payload-box");
      if (box) box.style.display = expandedPayloads[key] ? "block" : "none";
      setText(pt, expandedPayloads[key] ? "hide" : "show");
      return;
    }

    // unblock button
    var ub = target.closest("[data-unblock]");
    if (ub) {
      var parts = ub.getAttribute("data-unblock").split("::");
      var qName = parts[0];
      var gId = parts.slice(1).join("::");
      ub.disabled = true;
      ub.textContent = "...";
      fetch("/api/group-queues/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueName: qName, groupId: gId }),
      }).then(function(res) { return res.json(); })
        .then(function() { refresh(); })
        .catch(function(err) { alert("Unblock failed: " + err.message); })
        .finally(function() { ub.disabled = false; ub.textContent = "Unblock"; });
      return;
    }
  });

  function updateQueueOpenState(name) {
    var q = queueEls[name];
    if (!q) return;
    var open = !closedSections[name];
    q.chevron.className = "chevron" + (open ? " open" : "");
    q.body.className = "queue-body" + (open ? " open" : "");
  }

  // ---- build / patch ----
  var lastQueues = {};  // queueName -> queue data
  var queueOrder = [];  // ordered queue names currently in DOM

  function patch(data) {
    var queues = data.queues || [];
    var newNames = queues.map(function(q) { return q.name; });

    // remove queues no longer present
    for (var i = queueOrder.length - 1; i >= 0; i--) {
      var n = queueOrder[i];
      if (newNames.indexOf(n) === -1) {
        if (queueEls[n]) queueEls[n].section.remove();
        delete queueEls[n];
        delete lastQueues[n];
        queueOrder.splice(i, 1);
      }
    }

    // add / update queues
    for (var qi = 0; qi < queues.length; qi++) {
      var q = queues[qi];
      lastQueues[q.name] = q;

      if (!queueEls[q.name]) {
        // create section
        createQueueSection(q);
        queueOrder.push(q.name);
      } else {
        updateQueueSection(q);
      }
    }

    // ensure DOM order matches data order (rare, only on reorder)
    for (var oi = 0; oi < newNames.length; oi++) {
      var expected = newNames[oi];
      if (queueOrder[oi] !== expected) {
        // move in DOM
        var el = queueEls[expected].section;
        var ref = oi < container.children.length ? container.children[oi] : null;
        container.insertBefore(el, ref);
        // fix queueOrder
        var idx = queueOrder.indexOf(expected);
        queueOrder.splice(idx, 1);
        queueOrder.splice(oi, 0, expected);
      }
    }
  }

  function createQueueSection(q) {
    var section = document.createElement("div");
    section.className = "queue-section";

    // header
    var header = document.createElement("div");
    header.className = "queue-header";
    header.setAttribute("data-queue-toggle", q.name);

    var chevron = document.createElement("span");
    var open = !closedSections[q.name];
    chevron.className = "chevron" + (open ? " open" : "");
    chevron.textContent = "\\u25B6";

    var nameSpan = document.createElement("span");
    nameSpan.className = "queue-name";
    nameSpan.textContent = q.displayName;

    var link = document.createElement("a");
    link.className = "queue-link";
    link.href = q.bullBoardUrl;
    link.textContent = "view in BullBoard";
    link.addEventListener("click", function(e) { e.stopPropagation(); });

    var badges = document.createElement("div");
    badges.className = "queue-badges";

    var bJobs    = makeBadge("badge-jobs",    q.totalPendingJobs + " jobs");
    var bPending = makeBadge("badge-pending", q.pendingGroupCount + " pending groups");
    var bBlocked = makeBadge("badge-blocked", q.blockedGroupCount + " blocked");
    bBlocked.style.display = q.blockedGroupCount > 0 ? "" : "none";
    var bActive  = makeBadge("badge-active",  q.activeGroupCount + " active");

    badges.append(bJobs, bPending, bBlocked, bActive);
    header.append(chevron, nameSpan, link, badges);

    // body
    var body = document.createElement("div");
    body.className = "queue-body" + (open ? " open" : "");

    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Group ID", "Pending", "Oldest Job", "Newest Job", "Active Job", "Status", "Payload"].forEach(function(label, idx) {
      var th = document.createElement("th");
      th.textContent = label;
      if (idx === 1) th.className = "r";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement("tbody");
    table.append(thead, tbody);

    var showMore = document.createElement("div");
    showMore.className = "show-more";
    showMore.setAttribute("data-show-more", q.name);

    body.append(table, showMore);
    section.append(header, body);
    container.appendChild(section);

    queueEls[q.name] = {
      section: section,
      chevron: chevron,
      badges: { jobs: bJobs, pending: bPending, blocked: bBlocked, active: bActive },
      body: body,
      tbody: tbody,
      showMore: showMore,
    };

    rebuildGroups(q.name, q);
  }

  function makeBadge(cls, text) {
    var span = document.createElement("span");
    span.className = "badge " + cls;
    span.textContent = text;
    return span;
  }

  function updateQueueSection(q) {
    var el = queueEls[q.name];
    setText(el.badges.jobs,    q.totalPendingJobs + " jobs");
    setText(el.badges.pending, q.pendingGroupCount + " pending groups");
    setText(el.badges.blocked, q.blockedGroupCount + " blocked");
    el.badges.blocked.style.display = q.blockedGroupCount > 0 ? "" : "none";
    setText(el.badges.active,  q.activeGroupCount + " active");

    patchGroups(q.name, q);
  }

  // ---- group rows ----
  var groupOrder = {};  // queueName -> [groupId, ...]

  function rebuildGroups(queueName, q) {
    var el = queueEls[queueName];
    var tbody = el.tbody;
    tbody.innerHTML = "";
    // clean refs
    var prefix = queueName + "::";
    Object.keys(groupEls).forEach(function(k) {
      if (k.startsWith(prefix)) delete groupEls[k];
    });
    groupOrder[queueName] = [];

    var groups = q.groups;
    var expanded = expandedQueues[queueName];
    var visible = expanded ? groups : groups.slice(0, DEFAULT_VISIBLE);

    if (visible.length === 0) {
      var tr = document.createElement("tr");
      tr.className = "empty-row";
      var td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "No groups in staging";
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      visible.forEach(function(g) {
        createGroupRow(queueName, tbody, g);
      });
    }

    updateShowMore(queueName, q);
  }

  function patchGroups(queueName, q) {
    var el = queueEls[queueName];
    var tbody = el.tbody;
    var expanded = expandedQueues[queueName];
    var visible = expanded ? q.groups : q.groups.slice(0, DEFAULT_VISIBLE);
    var visibleIds = visible.map(function(g) { return g.groupId; });

    var order = groupOrder[queueName] || [];
    var prefix = queueName + "::";

    // remove groups no longer visible
    for (var i = order.length - 1; i >= 0; i--) {
      if (visibleIds.indexOf(order[i]) === -1) {
        var key = prefix + order[i];
        if (groupEls[key]) {
          groupEls[key].tr.remove();
          delete groupEls[key];
        }
        order.splice(i, 1);
      }
    }

    // Handle empty -> has groups transition (remove empty-row)
    if (visible.length > 0 && tbody.querySelector(".empty-row")) {
      tbody.querySelector(".empty-row").remove();
    }

    // add new / update existing
    for (var gi = 0; gi < visible.length; gi++) {
      var g = visible[gi];
      var gKey = prefix + g.groupId;

      if (!groupEls[gKey]) {
        createGroupRow(queueName, tbody, g);
      } else {
        updateGroupRow(queueName, g);
      }
    }

    // Handle has groups -> empty transition
    if (visible.length === 0 && !tbody.querySelector(".empty-row")) {
      order.length = 0;
      var tr = document.createElement("tr");
      tr.className = "empty-row";
      var td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "No groups in staging";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    updateShowMore(queueName, q);
  }

  function createGroupRow(queueName, tbody, g) {
    var key = queueName + "::" + g.groupId;
    var tr = document.createElement("tr");
    if (g.isBlocked) tr.className = "blocked";

    // Group ID
    var tdId = document.createElement("td");
    var idDiv = document.createElement("div");
    idDiv.className = "group-id";
    idDiv.textContent = g.groupId;
    tdId.appendChild(idDiv);

    // Pending
    var tdPending = document.createElement("td");
    tdPending.className = "r";
    tdPending.textContent = String(g.pendingJobs);

    // Oldest
    var tdOldest = document.createElement("td");
    var oldSpan = document.createElement("span");
    oldSpan.className = "time-ago";
    oldSpan.textContent = timeAgo(g.oldestJobMs);
    if (g.oldestJobMs) oldSpan.title = new Date(g.oldestJobMs).toISOString();
    tdOldest.appendChild(oldSpan);

    // Newest
    var tdNewest = document.createElement("td");
    var newSpan = document.createElement("span");
    newSpan.className = "time-ago";
    newSpan.textContent = timeAgo(g.newestJobMs);
    if (g.newestJobMs) newSpan.title = new Date(g.newestJobMs).toISOString();
    tdNewest.appendChild(newSpan);

    // Active
    var tdActive = document.createElement("td");
    if (g.hasActiveJob) {
      var aDiv = document.createElement("div");
      aDiv.className = "active-id";
      aDiv.textContent = g.activeJobId || "yes";
      aDiv.title = g.activeJobId || "";
      tdActive.appendChild(aDiv);
    } else {
      var pill = document.createElement("span");
      pill.className = "pill pill-none";
      pill.textContent = "None";
      tdActive.appendChild(pill);
    }

    // Status
    var tdStatus = document.createElement("td");
    var statusPill = document.createElement("span");
    statusPill.className = "pill " + (g.isBlocked ? "pill-blocked" : "pill-ok");
    statusPill.textContent = g.isBlocked ? "Blocked" : "OK";
    tdStatus.appendChild(statusPill);
    if (g.isBlocked) {
      var unblockBtn = document.createElement("button");
      unblockBtn.className = "btn-unblock";
      unblockBtn.setAttribute("data-unblock", queueName + "::" + g.groupId);
      unblockBtn.textContent = "Unblock";
      tdStatus.appendChild(unblockBtn);
    }

    // Payload
    var tdPayload = document.createElement("td");
    buildPayloadCell(tdPayload, queueName, g);

    tr.append(tdId, tdPending, tdOldest, tdNewest, tdActive, tdStatus, tdPayload);
    tbody.appendChild(tr);

    if (!groupOrder[queueName]) groupOrder[queueName] = [];
    groupOrder[queueName].push(g.groupId);

    groupEls[key] = {
      tr: tr,
      pending: tdPending,
      oldest: oldSpan,
      newest: newSpan,
      activeCell: tdActive,
      statusCell: tdStatus,
      statusPill: statusPill,
      payloadCell: tdPayload,
    };
  }

  function updateGroupRow(queueName, g) {
    var key = queueName + "::" + g.groupId;
    var el = groupEls[key];
    if (!el) return;

    el.tr.className = g.isBlocked ? "blocked" : "";

    // pending count
    setText(el.pending, String(g.pendingJobs));

    // times
    setText(el.oldest, timeAgo(g.oldestJobMs));
    if (g.oldestJobMs) setAttr(el.oldest, "title", new Date(g.oldestJobMs).toISOString());

    setText(el.newest, timeAgo(g.newestJobMs));
    if (g.newestJobMs) setAttr(el.newest, "title", new Date(g.newestJobMs).toISOString());

    // active job
    var ac = el.activeCell;
    if (g.hasActiveJob) {
      if (!ac.querySelector(".active-id")) {
        ac.innerHTML = "";
        var aDiv = document.createElement("div");
        aDiv.className = "active-id";
        aDiv.textContent = g.activeJobId || "yes";
        aDiv.title = g.activeJobId || "";
        ac.appendChild(aDiv);
      } else {
        var existing = ac.querySelector(".active-id");
        setText(existing, g.activeJobId || "yes");
        setAttr(existing, "title", g.activeJobId || "");
      }
    } else {
      if (!ac.querySelector(".pill")) {
        ac.innerHTML = "";
        var pill = document.createElement("span");
        pill.className = "pill pill-none";
        pill.textContent = "None";
        ac.appendChild(pill);
      }
    }

    // status
    el.statusPill.className = "pill " + (g.isBlocked ? "pill-blocked" : "pill-ok");
    setText(el.statusPill, g.isBlocked ? "Blocked" : "OK");

    // unblock button
    var existingBtn = el.statusCell.querySelector(".btn-unblock");
    if (g.isBlocked && !existingBtn) {
      var unblockBtn = document.createElement("button");
      unblockBtn.className = "btn-unblock";
      unblockBtn.setAttribute("data-unblock", queueName + "::" + g.groupId);
      unblockBtn.textContent = "Unblock";
      el.statusCell.appendChild(unblockBtn);
    } else if (!g.isBlocked && existingBtn) {
      existingBtn.remove();
    }

    // payload — only rebuild if not currently expanded (avoid nuking open previews)
    var payloadKey = queueName + "::" + g.groupId;
    if (!expandedPayloads[payloadKey]) {
      buildPayloadCell(el.payloadCell, queueName, g);
    }
  }

  function buildPayloadCell(td, queueName, g) {
    var payloadId = queueName + "::" + g.groupId;
    var isOpen = expandedPayloads[payloadId];

    td.innerHTML = "";
    if (g.jobs && g.jobs.length > 0 && g.jobs[0].data) {
      var toggle = document.createElement("span");
      toggle.className = "payload-toggle";
      toggle.setAttribute("data-payload-toggle", payloadId);
      toggle.textContent = (isOpen ? "hide" : "show") + " (" + g.jobs.length + " jobs)";

      var box = document.createElement("div");
      box.className = "payload-box";
      box.style.display = isOpen ? "block" : "none";
      box.textContent = formatJobs(g.jobs);

      td.append(toggle, box);
    } else {
      td.innerHTML = '<span style="color:#666">-</span>';
    }
  }

  function updateShowMore(queueName, q) {
    var el = queueEls[queueName];
    var expanded = expandedQueues[queueName];
    var hiddenCount = q.groups.length - DEFAULT_VISIBLE;

    if (!expanded && hiddenCount > 0) {
      el.showMore.style.display = "";
      el.showMore.textContent = "Show all " + q.groups.length + " groups (" + hiddenCount + " more)";
    } else if (expanded && q.groups.length > DEFAULT_VISIBLE) {
      el.showMore.style.display = "";
      el.showMore.textContent = "Show first " + DEFAULT_VISIBLE + " only";
    } else {
      el.showMore.style.display = "none";
    }
  }

  // ---- polling ----
  var statusDot  = document.getElementById("statusDot");
  var statusText = document.getElementById("statusText");

  async function refresh() {
    try {
      var res = await fetch("/api/group-queues");
      if (!res.ok) throw new Error(res.statusText);
      var data = await res.json();
      patch(data);
      statusDot.className  = "status-dot";
      statusText.textContent = "Live (5s)";
    } catch (e) {
      statusDot.className  = "status-dot error";
      statusText.textContent = "Error: " + e.message;
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;
}
