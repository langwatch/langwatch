/**
 * `finops_usage` rows for the company boards, ported from the prototype's
 * `src/lib/data/usage.ts` (buildUsage + seat/cloud/genie rows), spanning the
 * fiscal year to date instead of the prototype's fixed 90-day window.
 *
 * One flat row shape carries every charge kind (usage / seat / cloud /
 * activity), so department, team, tool, model, person, key, provider, resource
 * are all groupable dimensions — the whole point of a bill over a usage chart.
 */
import { createHash } from "node:crypto";

import { DAY_MS, dateKey } from "./dates";
import { Rng } from "./prng";
import {
  CLOUD_SPEND,
  DEPT_TOOL_AFFINITY,
  GENIE_ASKERS,
  GENIE_CONVERSATION_RESOURCE,
  MODEL_PROVIDER,
  MODEL_RATES,
  PROJECT_TRAFFIC,
  PROVIDER_DISCOUNT,
  personId,
  type ProviderId,
  TOOL_LAYER,
  TOOL_MODELS,
  TOOL_PROVIDER,
  TOOL_TOKENS_PER_REQ,
  TOOLS,
  UNALLOCATED,
  type WorldEntities,
} from "./world";

export interface FinopsRow {
  TenantId: string;
  RowId: string;
  Day: string;
  Charge: string;
  Tool: string;
  Provider: string;
  Agent: string;
  Model: string;
  PersonId: string;
  PersonName: string;
  TeamId: string;
  TeamName: string;
  DepartmentId: string;
  DepartmentName: string;
  Resource: string;
  KeyId: string;
  Requests: number;
  Units: number;
  Unit: string;
  TokensIn: number;
  TokensOut: number;
  CacheRead: number;
  CacheWrite: number;
  Errors: number;
  Cost: number;
  ListCost: number;
  UpdatedAt: number;
}

interface InternalRow {
  day: number;
  personId?: string;
  deptId: string;
  teamId?: string;
  toolId: string;
  model: string;
  agentId?: string;
  keyId?: string;
  resourceId?: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  errors: number;
  cacheRead?: number;
  cacheWrite?: number;
  layer: string;
  charge: "usage" | "seat" | "cloud" | "activity";
  provider: ProviderId;
  unit: string;
  listCost: number;
  units: number;
}

const CACHE_PROFILE: Record<string, { read: number; write: number }> = {
  "claude-code": { read: 0.978, write: 0.02 },
  cursor: { read: 0.9, write: 0.04 },
  copilot: { read: 0.82, write: 0.05 },
};

function weekendFactor(dateMs: number, weekendShare: number): number {
  const dow = new Date(dateMs).getUTCDay();
  return dow === 0 || dow === 6 ? weekendShare : 1;
}
function growth(day: number): number {
  return 1 + day * 0.004;
}

/** Databricks model mix shifts toward Claude over the trailing 30 days. */
function modelMix(toolId: string, day: number, numDays: number): [string, number][] {
  if (toolId === "databricks") {
    const cutover = numDays - 30;
    const claudeShare = day < cutover ? 0.25 : 0.25 + (0.5 * (day - cutover)) / 29;
    return [["llama-4-70b", 1 - claudeShare], ["claude-sonnet-4.5", claudeShare]];
  }
  return TOOL_MODELS[toolId] ?? [["gpt-5", 1]];
}

export interface FinopsConfig {
  tenantId: string;
  fiscalStartMs: number;
  todayMs: number;
  updatedAtMs: number;
  /**
   * Plan calibration. The prototype's raw per-day magnitudes were validated
   * over a 90-day window; its annual plan math lives in a monthly
   * reconstruction that down-scales the other months. Rather than port that
   * reconstruction, we scale the metered-usage dollars/tokens and the
   * Databricks cloud meter so the fiscal-year-to-date totals land near the
   * $240k Engineering / $84k Claude Code / $66k Databricks Genie plans.
   * Seats and Azure cloud stay at their real contracted dollars.
   */
  usageScale: number;
  dbxCloudScale: number;
}

export function buildFinopsRows(cfg: FinopsConfig, entities: WorldEntities): FinopsRow[] {
  const numDays = Math.round((cfg.todayMs - cfg.fiscalStartMs) / DAY_MS) + 1;
  const rows: InternalRow[] = [];

  const emit = (
    base: {
      day: number;
      deptId: string;
      teamId?: string;
      personId?: string;
      toolId: string;
      agentId?: string;
      keyId?: string;
      resourceId?: string;
    },
    models: [string, number][],
    requests: number,
    tokPerReq: number,
    errRate: number,
    rng: Rng,
  ) => {
    for (const [model, weight] of models) {
      const req = Math.round(requests * weight);
      if (req < 1) continue;
      const tokens = req * rng.jitter(tokPerReq, 0.3);
      const outShare = CACHE_PROFILE[base.toolId] ? 0.003 : 0.22;
      const tokensIn = Math.round(tokens * (1 - outShare));
      const tokensOut = Math.round(tokens * outShare);
      const provider =
        base.toolId === "custom"
          ? MODEL_PROVIDER[model] ?? "openai"
          : TOOL_PROVIDER[base.toolId] ?? "openai";
      const scale = cfg.usageScale;
      const scaledIn = Math.round(tokensIn * scale);
      const scaledOut = Math.round(tokensOut * scale);
      const cost = ((tokensIn + tokensOut) / 1e6) * (MODEL_RATES[model] ?? 5) * scale;
      const listCost = cost / (1 - PROVIDER_DISCOUNT[provider]);
      const errors = Math.round(req * rng.jitter(errRate, 0.6));
      const cacheProfile = CACHE_PROFILE[base.toolId];
      const cacheRead = cacheProfile
        ? Math.round(scaledIn * Math.min(0.985, rng.jitter(cacheProfile.read, 0.015)))
        : undefined;
      const cacheWrite = cacheProfile
        ? Math.min(scaledIn - (cacheRead ?? 0), Math.round(scaledIn * rng.jitter(cacheProfile.write, 0.2)))
        : undefined;
      rows.push({
        ...base,
        model,
        requests: req,
        tokensIn: scaledIn,
        tokensOut: scaledOut,
        cost,
        errors,
        cacheRead,
        cacheWrite,
        layer: TOOL_LAYER[base.toolId] ?? "direct",
        charge: "usage",
        provider,
        unit: "tokens",
        listCost,
        units: scaledIn + scaledOut,
      });
    }
  };

  /* ---- personal assistant usage ---- */
  for (const person of entities.people) {
    const affinities = DEPT_TOOL_AFFINITY[person.deptId] ?? [];
    const aff = new Rng(`aff:${person.id}`);
    for (const [toolId, prob, baseReq] of affinities) {
      if (!aff.chance(prob)) continue;
      // The one-person heavy-user spike belongs to the /me coding-agent tables,
      // not the company aggregate, so every engineer draws a normal intensity.
      const intensity = aff.jitter(1, 0.55);
      const keyId =
        person.id === "p-riley-chen" && toolId === "claude-code"
          ? "key-riley-dev"
          : person.id === "p-sarah-kim" && toolId === "claude-code"
            ? "key-sarah-dev"
            : undefined;
      for (let day = 0; day < numDays; day++) {
        const dateMs = cfg.fiscalStartMs + day * DAY_MS;
        const rng = new Rng(`u:${person.id}:${toolId}:${day}`);
        const req = rng.burst(baseReq * intensity * weekendFactor(dateMs, 0.22) * growth(day), 0.35);
        if (req < 1) continue;
        // FinOps has no main/subagent dimension (that lives on the /me
        // coding-agent events), so a person/tool/day emits one row per model.
        // Splitting by agent type here would collide on RowId — every split
        // shares the same finops dimensions — and ReplacingMergeTree would
        // silently drop all but one, undercounting the bill.
        emit(
          { day, deptId: person.deptId, teamId: person.teamId, personId: person.id, toolId, keyId },
          modelMix(toolId, day, numDays),
          req,
          TOOL_TOKENS_PER_REQ[toolId] ?? 3000,
          0.012,
          rng,
        );
      }
    }
  }

  /* ---- project production traffic (custom agents via the gateway) ---- */
  const projectKey: Record<string, string> = {
    "checkout-agent": "key-checkout-prod",
    "support-copilot": "key-support-prod",
    "docs-rag": "key-docs-rag",
    "fraud-triage": "key-fraud",
  };
  for (const agent of entities.agents) {
    if (!agent.projectId) continue;
    const traffic = PROJECT_TRAFFIC[agent.projectId];
    if (!traffic) continue;
    const teamId = PROJECT_TEAM[agent.projectId] ?? agent.deptId;
    const deptId = entities.teamById.get(teamId)?.deptId ?? agent.deptId;
    for (let day = agent.createdDay; day < numDays; day++) {
      const dateMs = cfg.fiscalStartMs + day * DAY_MS;
      const rng = new Rng(`u:proj:${agent.projectId}:${day}`);
      const req = rng.jitter(traffic.reqPerDay * weekendFactor(dateMs, 0.8) * growth(day), 0.18);
      emit(
        { day, deptId, teamId, agentId: agent.id, toolId: "custom", keyId: projectKey[agent.projectId] },
        traffic.models,
        req,
        traffic.tokPerReq,
        0.011,
        rng,
      );
    }
  }

  /* ---- standalone agents (Databricks / Copilot Studio / idle custom) ---- */
  const agentTraffic: Record<string, number> = {
    "sql-assistant": 420,
    "churn-predictor": 260,
    "revenue-forecaster": 180,
    "data-quality-bot": 300,
    "etl-doctor": 150,
    "hr-helpdesk": 190,
    "it-desk-bot": 140,
    "sales-brief-bot": 25,
    "meeting-summarizer": 160,
    "onboarding-helper": 8,
  };
  for (const agent of entities.agents) {
    if (agent.projectId) continue;
    const base = agentTraffic[agent.id] ?? 50;
    const toolId =
      agent.source === "databricks" ? "databricks" : agent.source === "copilot-studio" ? "copilot-studio" : "custom";
    const errRate = agent.status === "error" ? 0.08 : 0.012;
    const pauseDay = agent.id === "sales-brief-bot" ? numDays - 28 : undefined;
    const cutoverDay = numDays - 21;
    for (let day = agent.createdDay; day < numDays; day++) {
      if (pauseDay !== undefined && day >= pauseDay) continue;
      const dateMs = cfg.fiscalStartMs + day * DAY_MS;
      const rng = new Rng(`u:agent:${agent.id}:${day}`);
      const req = rng.jitter(base * weekendFactor(dateMs, 0.5) * growth(day), 0.25);
      if (req < 1) continue;
      const model = agent.id === "churn-predictor" && day >= cutoverDay ? "claude-sonnet-4.5" : agent.model;
      emit({ day, deptId: agent.deptId, agentId: agent.id, toolId }, [[model, 1]], req, TOOL_TOKENS_PER_REQ[toolId] ?? 3000, errRate, rng);
    }
  }

  /* ---- customer keys + CI (the gateway-billing story) ---- */
  const customerTraffic: [string, number, string, number, number][] = [
    ["key-cust-nimbus", 1000, "gpt-5-mini", 3400, 40],
    ["key-cust-northwind", 380, "claude-sonnet-4.5", 3000, 48],
    ["key-cust-zephyr", 560, "gpt-5-mini", 2600, 55],
  ];
  for (const [keyId, base, model, tok, createdDay] of customerTraffic) {
    for (let day = createdDay; day < numDays; day++) {
      const rng = new Rng(`u:cust:${keyId}:${day}`);
      emit({ day, deptId: "engineering", toolId: "custom", keyId }, [[model, 1]], rng.jitter(base * growth(day), 0.3), tok, 0.008, rng);
    }
  }
  for (let day = 12; day < numDays; day++) {
    const dateMs = cfg.fiscalStartMs + day * DAY_MS;
    const rng = new Rng(`u:ci:${day}`);
    emit(
      { day, deptId: "engineering", teamId: "platform", toolId: "custom", keyId: "key-ci" },
      [["claude-sonnet-4.5", 1]],
      rng.jitter(45 * weekendFactor(dateMs, 0.3), 0.4),
      9000,
      0.02,
      rng,
    );
  }

  /* Seats and cloud land after usage. */
  rows.push(...buildSeatRows(rows, numDays));
  rows.push(...buildCloudRows(numDays, cfg.fiscalStartMs, cfg.dbxCloudScale));
  rows.push(...buildGenieConversations(entities, numDays, cfg.fiscalStartMs));

  return rows.map((r) => toFinopsRow(r, cfg, entities));
}

const PROJECT_TEAM: Record<string, string> = {
  "checkout-agent": "checkout",
  "support-copilot": "support-ops",
  "docs-rag": "ai-tools",
  "fraud-triage": "ml",
};

function buildSeatRows(usage: InternalRow[], numDays: number): InternalRow[] {
  const rows: InternalRow[] = [];
  for (const tool of TOOLS) {
    if (tool.costPerSeatMonth <= 0 || tool.seats <= 0) continue;
    const byTeam = new Map<string, { deptId: string; teamId?: string; cost: number }>();
    let total = 0;
    for (const row of usage) {
      if (row.toolId !== tool.id || !row.personId || row.charge !== "usage") continue;
      const k = row.teamId ?? row.deptId;
      const entry = byTeam.get(k) ?? { deptId: row.deptId, teamId: row.teamId, cost: 0 };
      entry.cost += row.cost;
      total += row.cost;
      byTeam.set(k, entry);
    }
    const holders = [...byTeam.values()].sort((a, b) => b.cost - a.cost);
    const alloc: { deptId: string; teamId?: string; seats: number }[] = [];
    let assigned = 0;
    if (total > 0) {
      holders.forEach((h, i) => {
        const n = i === holders.length - 1 ? tool.activeSeats - assigned : Math.round(tool.activeSeats * (h.cost / total));
        if (n <= 0) return;
        alloc.push({ deptId: h.deptId, teamId: h.teamId, seats: n });
        assigned += n;
      });
    }
    const idle = tool.seats - assigned;
    if (idle > 0) alloc.push({ deptId: UNALLOCATED, seats: idle });
    const provider = TOOL_PROVIDER[tool.id] ?? "openai";
    const discount = PROVIDER_DISCOUNT[provider];
    for (const a of alloc) {
      const netPerDay = (a.seats * tool.costPerSeatMonth) / 30;
      const listPerDay = netPerDay / (1 - discount);
      for (let day = 0; day < numDays; day++) {
        rows.push({
          day,
          deptId: a.deptId,
          teamId: a.teamId,
          toolId: tool.id,
          model: "—",
          requests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cost: netPerDay,
          errors: 0,
          layer: "tool",
          charge: "seat",
          provider,
          unit: "seat-month",
          listCost: listPerDay,
          units: a.seats / 30,
        });
      }
    }
  }
  return rows;
}

function buildCloudRows(numDays: number, fiscalStartMs: number, dbxCloudScale: number): InternalRow[] {
  const rows: InternalRow[] = [];
  for (const c of CLOUD_SPEND) {
    const discount = PROVIDER_DISCOUNT[c.provider];
    const scale = c.provider === "databricks" ? dbxCloudScale : 1;
    for (let day = 0; day < numDays; day++) {
      const dateMs = fiscalStartMs + day * DAY_MS;
      const rng = new Rng(`cloud:${c.id}:${day}`);
      const cost = rng.jitter(c.perDay, 0.16) * growth(day) * weekendFactor(dateMs, 0.62) * scale;
      const listCost = cost / (1 - discount);
      rows.push({
        day,
        deptId: c.deptId ?? UNALLOCATED,
        teamId: c.teamId,
        toolId: c.toolId,
        resourceId: c.id,
        model: "—",
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost,
        errors: 0,
        layer: "cloud",
        charge: "cloud",
        provider: c.provider,
        unit: c.unit,
        listCost,
        units: listCost / c.unitRate,
      });
    }
  }
  return rows;
}

const GENIE_STATEMENTS_WITHOUT_AGENT = 0.1;

function buildGenieConversations(entities: WorldEntities, numDays: number, fiscalStartMs: number): InternalRow[] {
  const rows: InternalRow[] = [];
  const peopleById = new Map(entities.people.map((p) => [p.id, p]));
  const genieAgents = entities.agents.filter((a) => a.source === "databricks");

  const emitConversation = (person: { id: string; deptId: string; teamId: string }, day: number, conversations: number, agentId?: string) => {
    if (conversations < 1) return;
    rows.push({
      day,
      deptId: person.deptId,
      teamId: person.teamId,
      personId: person.id,
      agentId,
      toolId: "databricks",
      resourceId: GENIE_CONVERSATION_RESOURCE,
      model: "—",
      requests: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      errors: 0,
      layer: "cloud",
      charge: "activity",
      provider: "databricks",
      unit: "conversation",
      listCost: 0,
      units: conversations,
    });
  };

  for (const [name, perDay] of GENIE_ASKERS) {
    const person = peopleById.get(personId(name));
    if (!person) continue;
    const pick = new Rng(`genie-agents:${person.id}`);
    const offset = pick.int(0, Math.max(0, genieAgents.length - 1));
    const size = Math.min(genieAgents.length, pick.chance(0.5) ? 3 : 2);
    const fleet = Array.from({ length: size }, (_, i) => genieAgents[(offset + i) % genieAgents.length]!);
    for (let day = 0; day < numDays; day++) {
      const dateMs = fiscalStartMs + day * DAY_MS;
      const rng = new Rng(`genie:${person.id}:${day}`);
      const conversations = Math.round(rng.jitter(perDay * weekendFactor(dateMs, 0.18) * growth(day), 0.4));
      if (conversations < 1) continue;
      const orphaned = fleet.length ? Math.round(conversations * GENIE_STATEMENTS_WITHOUT_AGENT) : conversations;
      let left = conversations - orphaned;
      fleet.forEach((agent, i) => {
        const n = i === fleet.length - 1 ? left : Math.round(left / (fleet.length - i));
        left -= n;
        emitConversation(person, day, n, agent.id);
      });
      emitConversation(person, day, orphaned);
    }
  }
  return rows;
}

function toFinopsRow(r: InternalRow, cfg: FinopsConfig, entities: WorldEntities): FinopsRow {
  const dayMs = cfg.fiscalStartMs + r.day * DAY_MS;
  const person = r.personId ? entities.people.find((p) => p.id === r.personId) : undefined;
  const team = r.teamId ? entities.teamById.get(r.teamId) : undefined;
  const dept = entities.deptById.get(r.deptId);
  const idKey = [
    r.day,
    r.charge,
    r.toolId,
    r.model,
    r.personId ?? "",
    r.teamId ?? "",
    r.deptId,
    r.agentId ?? "",
    r.keyId ?? "",
    r.resourceId ?? "",
    r.provider,
  ].join("|");
  const rowId = createHash("sha256").update(`finops:${idKey}`).digest("hex").slice(0, 32);
  return {
    TenantId: cfg.tenantId,
    RowId: rowId,
    Day: dateKey(dayMs),
    Charge: r.charge,
    Tool: r.toolId,
    Provider: r.provider,
    Agent: r.agentId ?? "",
    Model: r.model,
    PersonId: r.personId ?? "",
    PersonName: person?.name ?? "",
    TeamId: r.teamId ?? "",
    TeamName: team?.name ?? "",
    DepartmentId: r.deptId === UNALLOCATED ? "" : r.deptId,
    DepartmentName: dept?.name ?? "",
    Resource: r.resourceId ?? "",
    KeyId: r.keyId ?? "",
    Requests: Math.max(0, Math.round(r.requests)),
    Units: Number(r.units.toFixed(4)),
    Unit: r.unit,
    TokensIn: Math.max(0, Math.round(r.tokensIn)),
    TokensOut: Math.max(0, Math.round(r.tokensOut)),
    CacheRead: Math.max(0, Math.round(r.cacheRead ?? 0)),
    CacheWrite: Math.max(0, Math.round(r.cacheWrite ?? 0)),
    Errors: Math.max(0, Math.round(r.errors)),
    Cost: Number(r.cost.toFixed(6)),
    ListCost: Number(r.listCost.toFixed(6)),
    UpdatedAt: cfg.updatedAtMs,
  };
}
