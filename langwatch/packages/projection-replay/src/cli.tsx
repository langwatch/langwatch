#!/usr/bin/env node
import "./env-defaults";
import dotenv from "dotenv";

// Load this package's .env with override so it wins over the cleared defaults
dotenv.config({ override: true });

import fs from "node:fs";
import readline from "node:readline";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import type {
  RegisteredFoldProjection,
  ReplayProgress,
  ReplayRuntime,
  DiscoveryResult,
  BatchCompleteInfo,
} from "../../../src/server/event-sourcing/replay";

import { createReplayRuntime } from "../../../src/server/event-sourcing/replay/replayPreset";
import { prisma } from "../../../src/server/db";
import { ReplayLog } from "./replayLog";
import {
  ReplayWizard,
  parseTenantIds,
  type ReplayConfig,
} from "./components/ReplayWizard";
import { TenantContinuePrompt } from "./components/TenantContinuePrompt";

// ─── Formatting helpers ───────────────────────────────────────────────────

const CLEAR = "\r\x1b[K";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const UP = (n: number) => `\x1b[${n}A`;

const SPINNER = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

// ─── Gunfight animation ──────────────────────────────────────────────────
// Two stick figures in a western duel — the replay phases drive the action.
//
// Figure positions (0-indexed visible columns):
//   Left figure:  head O at col 5, body | at col 5, legs at 4-6
//   Right figure: head O at col 33, body | at col 33, legs at 32-34

const RED = "\x1b[31m";
const PHASE_ICONS: Record<string, string> = {
  mark:   "\u2691",   // flag
  pause:  "\u23F8",   // pause
  drain:  "\u2248",   // waves
  cutoff: "\u2702",   // scissors
  replay: "\u25B6",   // play
  write:  "\u270E",   // pencil
  unmark: "\u2713",   // check
};

/** Place text segments at exact column positions — guarantees alignment. */
function at(...segments: [number, string][]): string {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  let out = "";
  let col = 0;
  for (const [targetCol, text] of segments) {
    if (targetCol > col) out += " ".repeat(targetCol - col);
    out += text;
    col = targetCol + strip(text).length;
  }
  return out;
}

// Column constants
const L = 5;   // left figure center (head & body |)
const R = 33;  // right figure center (head & body |)

function buildGunfightFrames(): string[][] {
  // Reusable figure parts
  const lStand = "/|\\";     // left body, | at L
  const rStand = "/|\\";     // right body, | at R
  const lLegs  = "/ \\";
  const rLegs  = "/ \\";
  const lGun   = "/|\u2550="; // /|═= (gun extends right from body)
  const rGun   = "=\u2550|\\"; // =═|\ (gun extends left from body)
  const dot4   = `${DIM}\u00B7   \u00B7   \u00B7   \u00B7${RESET}`;  // · · · · (13 visible)
  const bullet = (n: number) => "\u2500".repeat(n);

  return [
    [ // 0: Standoff
      at([L, "O"], [13, `${DIM}\u00B7   \u00B7   \u00B7   \u00B7${RESET}`], [R, "O"]),
      at([L-1, lStand], [R-1, rStand]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 1: Tumbleweed rolls
      at([L, "O"], [R, "O"]),
      at([L-1, lStand], [18, `${YELLOW}\u00B0${RESET}`], [R-1, rStand]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 2: Left draws
      at([L, "O"], [R, "O"]),
      at([L-1, lGun], [13, dot4], [R-1, rStand]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 3: Left shoots!
      at([L, "O"], [R, "O"]),
      at([L-1, lGun], [L+3, `${YELLOW}${bullet(11)}\u25B6${RESET}`], [R-1, rStand]),
      at([L-1, lLegs], [15, `${DIM}pew!${RESET}`], [R-1, rLegs]),
    ],
    [ // 4: Bullet hits right (impact)
      at([L, "O"], [R-1, `${YELLOW}*${RESET}`], [R, "O"]),
      at([L-1, lGun], [L+3, `${YELLOW}\u00B7 \u00B7 \u00B7 \u00B7 \u00B7${RESET}`], [R-1, rStand]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 5: Right dodges
      at([L, "O"], [R-1, "\\O"]),
      at([L-1, lGun], [L+3, `${YELLOW}\u00B7   \u00B7   \u00B7${RESET}`], [R, "|"]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 6: Right recovers, draws
      at([L, "O"], [R, "O"]),
      at([L-1, lStand], [13, dot4], [R-2, rGun]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 7: Right shoots!
      at([L, "O"], [R, "O"]),
      at([L-1, lStand], [L+2, `${YELLOW}\u25C0${bullet(11)}${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [20, `${DIM}!wep${RESET}`], [R-1, rLegs]),
    ],
    [ // 8: Bullet hits left (impact)
      at([L+1, `${YELLOW}*${RESET}`], [L, "O"], [R, "O"]),
      at([L-1, lStand], [L+2, `${YELLOW}\u00B7 \u00B7 \u00B7 \u00B7 \u00B7${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 9: Left dodges
      at([L, "O/"], [R, "O"]),
      at([L, "|"], [L+2, `${YELLOW}\u00B7   \u00B7   \u00B7${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 10: Both draw
      at([L, "O"], [19, `${RED}\u00B7${RESET}`], [R, "O"]),
      at([L-1, lGun], [13, `${DIM}\u00B7   \u00B7   \u00B7   \u00B7${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [R-1, rLegs]),
    ],
    [ // 11: Both shoot! Bullets cross
      at([L, "O"], [R, "O"]),
      at([L-1, lGun], [L+3, `${YELLOW}${bullet(4)}\u25B6${RESET}`], [18, `${RED}\u2736${RESET}`], [20, `${YELLOW}\u25C0${bullet(4)}${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [13, `${DIM}pew! !wep${RESET}`], [R-1, rLegs]),
    ],
    [ // 12: Explosion
      at([L, "O"], [15, `${RED}\\${RESET}`], [17, `${YELLOW}*${RESET}`], [19, `${RED}|${RESET}`], [21, `${YELLOW}*${RESET}`], [23, `${RED}/${RESET}`], [R, "O"]),
      at([L-1, lGun], [13, `${RED}${bullet(2)}${RESET}`], [16, `${YELLOW}\u2605${RESET}`], [18, `${RED}\u2605${RESET}`], [20, `${YELLOW}\u2605${RESET}`], [23, `${RED}${bullet(2)}${RESET}`], [R-2, rGun]),
      at([L-1, lLegs], [15, `${RED}/${RESET}`], [17, `${YELLOW}*${RESET}`], [19, `${RED}|${RESET}`], [21, `${YELLOW}*${RESET}`], [23, `${RED}\\${RESET}`], [R-1, rLegs]),
    ],
    [ // 13: Smoke
      at([L, "O"], [12, `${DIM}~  ~  ~  ~  ~${RESET}`], [R, "O"]),
      at([L-1, lStand], [11, `${DIM}~  ~  ~  ~  ~  ~${RESET}`], [R-1, rStand]),
      at([L-1, lLegs], [12, `${DIM}~  ~  ~  ~  ~${RESET}`], [R-1, rLegs]),
    ],
  ];
}

const GUNFIGHT_FRAMES = buildGunfightFrames();

class GunfightAnimation {
  private tick = 0;
  private phase: string = "mark";

  setPhase(phase: string) { this.phase = phase; }

  nextFrame(): string[] {
    this.tick++;

    if (this.phase === "replay") {
      // Full shooting cycle — both cowboys trade shots
      const seq = [3, 4, 5, 6, 7, 8, 9, 10, 11];
      const idx = Math.floor(this.tick / 3) % seq.length;
      return GUNFIGHT_FRAMES[seq[idx]!]!;
    }

    if (this.phase === "write") {
      // Explosion + smoke
      const seq = [11, 12, 12, 13, 13];
      const idx = Math.floor(this.tick / 3) % seq.length;
      return GUNFIGHT_FRAMES[seq[idx]!]!;
    }

    if (this.phase === "drain") {
      // Tense standoff — tumbleweed rolls
      const seq = [0, 0, 1, 0, 0];
      const idx = Math.floor(this.tick / 4) % seq.length;
      return GUNFIGHT_FRAMES[seq[idx]!]!;
    }

    if (this.phase === "cutoff") {
      // Drawing guns
      const seq = [0, 2, 6, 10];
      const idx = Math.floor(this.tick / 4) % seq.length;
      return GUNFIGHT_FRAMES[seq[idx]!]!;
    }

    // Default (mark, pause, unmark): calm standoff
    return GUNFIGHT_FRAMES[0]!;
  }

  reset() {
    this.tick = 0;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h${remainMins}m${secs}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function progressBar(current: number, total: number, width = 30): string {
  const pct = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty) + ` ${Math.round(pct * 100)}%`;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y") || answer === "");
    });
  });
}

// ─── Connection helpers ───────────────────────────────────────────────────

function resolveRedisUrl(opts: { redisUrl?: string }): string {
  const url = opts.redisUrl ?? process.env.REDIS_URL;
  if (!url) {
    console.error("Redis URL is required. Pass --redis-url or set REDIS_URL.");
    process.exit(1);
  }
  return url;
}

function resolveDatabaseUrl(opts: { databaseUrl?: string }): string {
  const url = opts.databaseUrl || process.env.DATABASE_URL || "";
  if (!url) {
    console.error("Database URL is required. Pass --database-url or set DATABASE_URL.");
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  return url;
}

function initRuntime(opts: { redisUrl?: string; databaseUrl?: string }): ReplayRuntime {
  resolveDatabaseUrl(opts);
  return createReplayRuntime({ redisUrl: resolveRedisUrl(opts) });
}

async function fetchProject(tenantId: string): Promise<{ name: string; slug: string } | null> {
  return prisma.project.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
}

function resolveProjections(names: string, all: RegisteredFoldProjection[]): RegisteredFoldProjection[] {
  const requested = names.split(",").map((n) => n.trim());
  const resolved: RegisteredFoldProjection[] = [];
  const missing: string[] = [];
  for (const name of requested) {
    const found = all.find((p) => p.projectionName === name);
    if (found) resolved.push(found);
    else missing.push(name);
  }
  if (missing.length > 0) {
    console.error(`Projection(s) not found: ${missing.join(", ")}\nAvailable: ${all.map((p) => p.projectionName).join(", ") || "none"}`);
    process.exit(1);
  }
  return resolved;
}

function readTenantFile(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}

// ─── Ink wizard helpers ───────────────────────────────────────────────────

function runWizard(props: {
  availableProjections: RegisteredFoldProjection[];
  initialTenantIds?: string[];
  initialProjections?: RegisteredFoldProjection[];
  initialSince?: string;
  initialConcurrency?: number;
  initialDryRun?: boolean;
}): Promise<ReplayConfig | null> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ReplayWizard
        availableProjections={props.availableProjections}
        initialTenantIds={props.initialTenantIds}
        initialProjections={props.initialProjections}
        initialSince={props.initialSince}
        initialConcurrency={props.initialConcurrency}
        initialDryRun={props.initialDryRun}
        onComplete={(config) => { unmount(); resolve(config); }}
        onCancel={() => { unmount(); resolve(null); }}
      />,
    );
  });
}

function runProjectionPicker(props: {
  tenantId: string;
  projectInfo: { name: string; slug: string } | null;
  availableProjections: RegisteredFoldProjection[];
}): Promise<RegisteredFoldProjection[] | null> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ReplayWizard
        tenantId={props.tenantId}
        projectInfo={props.projectInfo}
        availableProjections={props.availableProjections}
        initialTenantIds={[props.tenantId]}
        initialSince="unused"
        initialConcurrency={1}
        initialDryRun={false}
        onComplete={(config) => { unmount(); resolve(config.projections); }}
        onCancel={() => { unmount(); resolve(null); }}
      />,
    );
  });
}

function runTenantContinuePrompt(
  nextTenantId: string,
  nextProjectInfo: { name: string; slug: string } | null,
): Promise<"continue" | "abort"> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <TenantContinuePrompt
        nextTenantId={nextTenantId}
        nextProjectInfo={nextProjectInfo}
        onContinue={() => { unmount(); resolve("continue"); }}
        onAbort={() => { unmount(); resolve("abort"); }}
      />,
    );
  });
}

// ─── Discovery + Plan ─────────────────────────────────────────────────────

interface DiscoveryPlan {
  discoveries: Map<string, DiscoveryResult>;
  totalEvents: number;
  totalAggregates: number;
}

async function discoverAndShowPlan({
  runtime,
  projections,
  tenantIds,
  since,
  aggregateBatchSize,
}: {
  runtime: ReplayRuntime;
  projections: RegisteredFoldProjection[];
  tenantIds: string[];
  since: string;
  aggregateBatchSize: number;
}): Promise<DiscoveryPlan | null> {
  console.log();
  console.log(`  ${DIM}Discovering affected aggregates...${RESET}`);

  const discoveries = new Map<string, DiscoveryResult>();
  let grandTotalAggregates = 0;
  let grandTotalEvents = 0;
  const grandTotalTenants = new Set<string>();

  for (const projection of projections) {
    const discoveryTenants = tenantIds.length > 0 ? tenantIds : [undefined];
    let projAggregates = 0;
    let projEvents = 0;
    const projTenants = new Set<string>();

    for (const tid of discoveryTenants) {
      const result = await runtime.service.discover({ projection, since, tenantId: tid });
      projAggregates += result.aggregates.length;
      projEvents += result.totalEvents;
      for (const t of result.byTenant.keys()) projTenants.add(t);

      if (!discoveries.has(projection.projectionName)) {
        discoveries.set(projection.projectionName, result);
      } else {
        const existing = discoveries.get(projection.projectionName)!;
        existing.aggregates = existing.aggregates.concat(result.aggregates);
        existing.totalEvents += result.totalEvents;
        for (const [t, aggs] of result.byTenant) {
          const prev = existing.byTenant.get(t) ?? [];
          existing.byTenant.set(t, prev.concat(aggs));
        }
        existing.tenantCount = existing.byTenant.size;
      }
    }

    grandTotalAggregates += projAggregates;
    grandTotalEvents += projEvents;
    for (const t of projTenants) grandTotalTenants.add(t);
  }

  // Show the plan
  console.log();
  console.log(`  ${BOLD}Replay Plan${RESET}`);
  console.log(`  ${"─".repeat(56)}`);
  console.log(`  ${DIM}since${RESET}       ${since}`);
  console.log(`  ${DIM}tenants${RESET}     ${grandTotalTenants.size === 0 ? "none found" : grandTotalTenants.size}`);
  console.log(`  ${DIM}aggregates${RESET}  ${formatNumber(grandTotalAggregates)}`);
  console.log(`  ${DIM}events${RESET}      ${formatNumber(grandTotalEvents)}`);
  console.log(`  ${DIM}batches${RESET}     ~${Math.ceil(grandTotalAggregates / aggregateBatchSize)}`);
  console.log();

  for (const projection of projections) {
    const disc = discoveries.get(projection.projectionName);
    if (!disc) continue;
    const tenants = [...disc.byTenant.entries()];
    console.log(`  ${BOLD}${projection.projectionName}${RESET}  ${DIM}(${projection.pipelineName})${RESET}`);
    if (tenants.length <= 5) {
      for (const [tid, aggs] of tenants) {
        console.log(`    ${DIM}${tid}${RESET}  ${aggs.length} aggregates`);
      }
    } else {
      for (const [tid, aggs] of tenants.slice(0, 3)) {
        console.log(`    ${DIM}${tid}${RESET}  ${aggs.length} aggregates`);
      }
      console.log(`    ${DIM}... and ${tenants.length - 3} more tenants${RESET}`);
    }
    console.log();
  }

  if (grandTotalAggregates === 0) {
    console.log(`  ${YELLOW}No aggregates found — nothing to replay.${RESET}`);
    console.log();
    return null;
  }

  return { discoveries, totalEvents: grandTotalEvents, totalAggregates: grandTotalAggregates };
}

// ─── Replay progress display ──────────────────────────────────────────────

function createProgressDisplay({ totalEventsEstimate }: { totalEventsEstimate: number }) {
  let startMs = Date.now();
  let spinIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastProgress: ReplayProgress | null = null;
  let currentProjection = "";
  let batchStartMs = Date.now();
  let liveLines = 0; // how many live lines currently on screen
  const animation = new GunfightAnimation();

  function clearLive() {
    if (liveLines > 0) {
      // Move up to the first live line, then clear each
      if (liveLines > 1) process.stdout.write(UP(liveLines - 1));
      for (let i = 0; i < liveLines; i++) {
        process.stdout.write(`${CLEAR}${i < liveLines - 1 ? "\n" : ""}`);
      }
      if (liveLines > 1) process.stdout.write(UP(liveLines - 1));
      liveLines = 0;
    }
  }

  function renderLive() {
    if (!lastProgress) return;
    const p = lastProgress;

    const spin = SPINNER[spinIdx++ % SPINNER.length]!;
    const elapsed = formatDuration((Date.now() - startMs) / 1000);
    const batchElapsed = formatDuration((Date.now() - batchStartMs) / 1000);
    const batchLabel = `${p.currentBatch}/${p.totalBatches}`;
    const icon = PHASE_ICONS[p.batchPhase] ?? "\u2022";
    const rate = p.totalEventsReplayed > 0 && (Date.now() - startMs) > 1000
      ? `${formatNumber(Math.round(p.totalEventsReplayed / ((Date.now() - startMs) / 1000)))} evt/s`
      : "";

    // Batch phase info
    let phaseInfo: string;
    if (p.batchPhase === "replay" && p.batchEventsProcessed > 0) {
      phaseInfo = `${icon} replaying ${formatNumber(p.batchEventsProcessed)} events`;
    } else if (p.batchPhase === "write") {
      phaseInfo = `${icon} writing ${formatNumber(p.batchEventsProcessed)} events`;
    } else {
      phaseInfo = `${icon} ${p.batchPhase}`;
    }

    const bar = progressBar(p.aggregatesCompleted, p.totalAggregates, 16);
    const aggInfo = `${formatNumber(p.aggregatesCompleted)}/${formatNumber(p.totalAggregates)} aggs`;

    // Line 1: batch status
    const statusLine = `  ${CYAN}${spin}${RESET} ${batchLabel}  ${phaseInfo}  ${DIM}${batchElapsed}${RESET}`;
    // Line 2: animation
    const frame = animation.nextFrame();
    const animLine = `${frame[0]}\n${frame[1]}\n${frame[2]}`;
    // Line 3: overall progress
    const overallLine = `  ${bar}  ${aggInfo}  ${formatNumber(p.totalEventsReplayed)} events  ${elapsed}  ${DIM}${rate}${RESET}`;

    // Erase previous live lines
    if (liveLines > 1) process.stdout.write(UP(liveLines - 1));

    process.stdout.write(
      `${CLEAR}${statusLine}\n` +
      `${CLEAR}\n` +
      `${CLEAR}${frame[0]}\n` +
      `${CLEAR}${frame[1]}\n` +
      `${CLEAR}${frame[2]}\n` +
      `${CLEAR}\n` +
      `${CLEAR}${overallLine}`,
    );
    liveLines = 7;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => renderLive(), 150);
    if (timer && typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    start() {
      startMs = Date.now();
      batchStartMs = Date.now();
      startTimer();
    },

    update(progress: ReplayProgress) {
      if (progress.currentProjectionName !== currentProjection) {
        clearLive();
        currentProjection = progress.currentProjectionName;
        if (progress.totalProjections > 1) {
          console.log(`  ${BOLD}[${progress.currentProjectionIndex + 1}/${progress.totalProjections}] ${currentProjection}${RESET}`);
        } else {
          console.log(`  ${BOLD}${currentProjection}${RESET}`);
        }
        console.log(`  ${"─".repeat(50)}`);
        batchStartMs = Date.now();
        animation.reset();
      }

      animation.setPhase(progress.batchPhase);
      lastProgress = progress;
      renderLive();
    },

    onBatchComplete(info: BatchCompleteInfo) {
      clearLive();
      animation.reset();

      const batchLabel = `${String(info.batchNum).padStart(String(info.totalBatches).length)}/${info.totalBatches}`;
      const rate = info.durationSec > 0.1 && info.eventsInBatch > 0
        ? `${formatNumber(Math.round(info.eventsInBatch / info.durationSec))} evt/s`
        : "";
      console.log(
        `  ${GREEN}\u2713${RESET} ${batchLabel}  ${formatNumber(info.eventsInBatch).padStart(8)} events  ${formatDuration(info.durationSec).padStart(7)}  ${DIM}${rate}${RESET}`,
      );

      batchStartMs = Date.now();
    },

    finish(result: { aggregatesReplayed: number; totalEvents: number; batchErrors: number; firstError?: string }, elapsedSec: number) {
      stopTimer();
      clearLive();

      const rate = elapsedSec > 0.1 && result.totalEvents > 0
        ? `${formatNumber(Math.round(result.totalEvents / elapsedSec))} evt/s`
        : "";
      const errors = result.batchErrors > 0
        ? `  ${YELLOW}${result.batchErrors} error(s)${RESET}`
        : "";
      console.log();
      console.log(
        `  ${GREEN}Done${RESET}  ${formatNumber(result.aggregatesReplayed)} aggregates  ${formatNumber(result.totalEvents)} events  ${formatDuration(elapsedSec)}  ${DIM}${rate}${RESET}${errors}`,
      );
    },

    stop() { stopTimer(); },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const program = new Command();
  program.name("projection-replay").description("Replay historical events through fold projections");

  program
    .command("replay")
    .option("--projection <name>", "Projection name(s), comma-separated (interactive if omitted)")
    .option("--tenant-id <ids>", "Tenant ID(s), comma-separated (all tenants if omitted)")
    .option("--tenant-file <path>", "File with tenant IDs (one per line, unattended mode)")
    .option("--since <date>", "Discover aggregates with events from this date (YYYY-MM-DD)")
    .option("--redis-url <url>", "Redis URL (or REDIS_URL env)")
    .option("--database-url <url>", "Database URL (or DATABASE_URL env)")
    .option("--batch-size <number>", "Events per ClickHouse page", "5000")
    .option("--aggregate-batch-size <number>", "Aggregates per batch", "1000")
    .option("--concurrency <number>", "Parallel aggregate replays per batch", "10")
    .option("--dry-run", "Discover and count without replaying", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (opts: {
      projection?: string;
      tenantId?: string;
      tenantFile?: string;
      since?: string;
      redisUrl?: string;
      databaseUrl?: string;
      batchSize: string;
      aggregateBatchSize: string;
      concurrency: string;
      dryRun: boolean;
      yes: boolean;
    }) => {
      if (opts.tenantId && opts.tenantFile) {
        console.error("--tenant-id and --tenant-file are mutually exclusive.");
        process.exit(1);
      }

      const cliTenantIds = opts.tenantFile
        ? readTenantFile(opts.tenantFile)
        : opts.tenantId
          ? parseTenantIds(opts.tenantId)
          : undefined;

      if (opts.tenantFile && (!cliTenantIds || cliTenantIds.length === 0)) {
        console.error("--tenant-file is empty or contains only comments. Refusing to replay all tenants in unattended mode.");
        process.exit(1);
      }

      const batchMode = !!opts.tenantFile;
      const needsWizard = !opts.projection || !opts.since;

      const runtime = initRuntime(opts);

      let tenantIds: string[];
      let projections: RegisteredFoldProjection[];
      let since: string;
      let concurrency: number;
      let dryRun: boolean;

      if (needsWizard) {
        let initialProjections: RegisteredFoldProjection[] | undefined;
        if (opts.projection) {
          initialProjections = resolveProjections(opts.projection, runtime.projections);
        }
        const initialConcurrency = parseInt(opts.concurrency, 10);

        const config = await runWizard({
          availableProjections: runtime.projections,
          initialTenantIds: cliTenantIds,
          initialProjections,
          initialSince: opts.since,
          initialConcurrency: isNaN(initialConcurrency) ? undefined : initialConcurrency,
          initialDryRun: undefined,
        });

        if (!config) { console.log("Cancelled."); await runtime.close(); return; }

        tenantIds = config.tenantIds;
        projections = config.projections;
        since = config.since;
        concurrency = config.concurrency;
        dryRun = config.dryRun;
      } else {
        tenantIds = cliTenantIds ?? [];
        projections = resolveProjections(opts.projection!, runtime.projections);
        since = opts.since!;
        const parsedConcurrency = parseInt(opts.concurrency, 10);
        if (isNaN(parsedConcurrency) || parsedConcurrency < 1) {
          console.error("--concurrency must be a positive integer.");
          process.exit(1);
        }
        concurrency = parsedConcurrency;
        dryRun = opts.dryRun;
      }

      const batchSize = parseInt(opts.batchSize, 10);
      if (isNaN(batchSize) || batchSize < 1) { console.error("--batch-size must be a positive integer."); process.exit(1); }
      const aggregateBatchSize = parseInt(opts.aggregateBatchSize, 10);
      if (isNaN(aggregateBatchSize) || aggregateBatchSize < 1) { console.error("--aggregate-batch-size must be a positive integer."); process.exit(1); }

      // ── Phase 1: Discover & show plan ──

      const plan = await discoverAndShowPlan({
        runtime, projections, tenantIds, since, aggregateBatchSize,
      });

      if (!plan) { await runtime.close(); return; }

      if (dryRun) {
        console.log(`  ${DIM}Dry run — no changes made.${RESET}`);
        console.log();
        await runtime.close();
        return;
      }

      // ── Phase 2: Confirm ──

      if (!opts.yes && !batchMode) {
        const ok = await confirm(`  Proceed with replay? [Y/n] `);
        if (!ok) { console.log("Cancelled."); await runtime.close(); return; }
      }

      // ── Phase 3: Execute ──

      const log = new ReplayLog(projections[0]?.projectionName ?? "replay");
      const display = createProgressDisplay({ totalEventsEstimate: plan.totalEvents });

      try {
        console.log();

        if (tenantIds.length === 0) {
          // All-tenants mode
          display.start();
          const startMs = Date.now();
          const result = await runtime.service.replay(
            { projections, tenantIds: [], since, batchSize, aggregateBatchSize, concurrency, dryRun },
            {
              log,
              onProgress: (p) => display.update(p),
              onBatchComplete: (info) => display.onBatchComplete(info),
            },
          );
          display.finish(result, (Date.now() - startMs) / 1000);
        } else {
          // Per-tenant mode
          const tenantInfos = await Promise.all(
            tenantIds.map(async (tid) => ({ tenantId: tid, projectInfo: await fetchProject(tid) })),
          );

          for (let i = 0; i < tenantInfos.length; i++) {
            const { tenantId, projectInfo } = tenantInfos[i]!;

            if (tenantInfos.length > 1) {
              console.log(`  ${BOLD}[${i + 1}/${tenantInfos.length}]${RESET} ${projectInfo ? `${projectInfo.name} (${tenantId})` : tenantId}`);
            }

            display.start();
            const startMs = Date.now();
            const result = await runtime.service.replay(
              { projections, tenantIds: [tenantId], since, batchSize, aggregateBatchSize, concurrency, dryRun },
              {
                log,
                onProgress: (p) => display.update(p),
                onBatchComplete: (info) => display.onBatchComplete(info),
              },
            );
            display.finish(result, (Date.now() - startMs) / 1000);

            if (batchMode && result.batchErrors > 0) {
              console.error(`  Stopping — errors in ${tenantId}: ${result.firstError ?? "unknown"}`);
              break;
            }

            if (!batchMode && i < tenantInfos.length - 1) {
              const next = tenantInfos[i + 1]!;
              const choice = await runTenantContinuePrompt(next.tenantId, next.projectInfo);
              if (choice === "abort") { console.log("  Aborted."); break; }
            }
          }
        }
      } finally {
        display.stop();
        log.close();
        console.log(`  ${DIM}Log: ${log.filePath}${RESET}`);
        console.log();
        await runtime.close();
      }
    });

  // ─── Cleanup command ──────────────────────────────────────────────────

  program
    .command("cleanup")
    .option("--projection <name>", "Projection name(s), comma-separated")
    .option("--redis-url <url>", "Redis URL (or REDIS_URL env)")
    .option("--database-url <url>", "Database URL (or DATABASE_URL env)")
    .action(async (opts: { projection?: string; redisUrl?: string; databaseUrl?: string }) => {
      const runtime = initRuntime(opts);
      let projectionNames: string[];

      if (opts.projection) {
        projectionNames = opts.projection.split(",").map((n) => n.trim());
      } else {
        const selected = await runProjectionPicker({
          tenantId: "unknown",
          projectInfo: null,
          availableProjections: runtime.projections,
        });
        if (!selected) { console.log("Cancelled."); await runtime.close(); return; }
        projectionNames = selected.map((p) => p.projectionName);
      }

      for (const name of projectionNames) {
        await runtime.service.cleanup(name);
        console.log(`  Cleaned up markers for "${name}".`);
      }
      await runtime.close();
    });

  // ─── List command ─────────────────────────────────────────────────────

  program
    .command("list")
    .description("List all discovered fold projections")
    .option("--redis-url <url>", "Redis URL (or REDIS_URL env)")
    .option("--database-url <url>", "Database URL (or DATABASE_URL env)")
    .action(async (opts: { redisUrl?: string; databaseUrl?: string }) => {
      const runtime = initRuntime(opts);
      const all = runtime.projections;

      if (all.length === 0) { console.log("No fold projections found."); await runtime.close(); return; }

      console.log();
      console.log(`  ${BOLD}Fold Projections${RESET}`);
      console.log("  " + "\u2500".repeat(60));
      console.log();

      for (const p of all) {
        const source = p.source === "global" ? "global" : p.pipelineName;
        console.log(`  ${BOLD}${p.projectionName}${RESET}  ${DIM}(${source})${RESET}`);
        console.log(`  events:  ${p.definition.eventTypes.join(", ")}`);
        console.log(`  pause:   ${p.pauseKey}`);
        console.log();
      }

      console.log(`  ${all.length} projection(s) found`);
      console.log();
      await runtime.close();
    });

  // ─── Fight command ──────────────────────────────────────────────────

  program
    .command("fight")
    .description("Watch a stick figure gunfight (entertainment while you wait)")
    .action(async () => {
      const phases = ["mark", "pause", "drain", "cutoff", "replay", "replay", "replay", "replay", "write", "unmark"];
      const phaseDurations = [8, 5, 15, 8, 40, 40, 40, 40, 12, 5];
      const anim = new GunfightAnimation();
      let phaseIdx = 0;
      let phaseTick = 0;
      let linesDrawn = 0;

      console.log();
      console.log(`  ${BOLD}Projection Replay${RESET} ${DIM}\u2014 The Showdown${RESET}`);
      console.log(`  ${"─".repeat(50)}`);
      console.log();

      const interval = setInterval(() => {
        // Advance phase
        phaseTick++;
        if (phaseTick >= phaseDurations[phaseIdx]!) {
          phaseTick = 0;
          phaseIdx = (phaseIdx + 1) % phases.length;
          anim.reset();
        }

        const phase = phases[phaseIdx]!;
        anim.setPhase(phase);
        const frames = anim.nextFrame();

        if (linesDrawn > 0) {
          process.stdout.write(UP(linesDrawn));
        }

        const phaseLabel = `  ${CYAN}${PHASE_ICONS[phase] ?? "\u2022"}${RESET} ${phase}`;
        process.stdout.write(
          `${CLEAR}${phaseLabel}\n` +
          `${CLEAR}${frames[0]}\n` +
          `${CLEAR}${frames[1]}\n` +
          `${CLEAR}${frames[2]}\n` +
          `${CLEAR}`,
        );
        linesDrawn = 4;
      }, 150);

      // Keep alive until Ctrl+C
      if (interval && typeof interval === "object" && "unref" in interval) {
        // Don't unref — keep the process alive
      }

      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          clearInterval(interval);
          if (linesDrawn > 0) {
            process.stdout.write(UP(linesDrawn));
            for (let i = 0; i < linesDrawn; i++) {
              process.stdout.write(`${CLEAR}\n`);
            }
            process.stdout.write(UP(linesDrawn));
          }
          console.log(`  ${GREEN}\u2713${RESET} Draw! Both cowboys live to replay another day.`);
          console.log();
          resolve();
        });
      });
    });

  const argv = [...process.argv];
  if (argv[2] === "--") argv.splice(2, 1);
  await program.parseAsync(argv);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
