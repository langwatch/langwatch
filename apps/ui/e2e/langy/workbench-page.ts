/**
 * The real workbench page in a headless browser, signed in with the suite's own
 * session. With an adapter it opens the adapter's conversation in its Langy panel,
 * so the page itself claims and carries out the turn's `ui` entries.
 */
import { LANGY_CONVERSATION_PARAM } from "@langwatch/langy-contract";
import { type Browser, chromium, type Page } from "playwright";

import { APP_BASE, CONFIG } from "./config";
import type { LangyAdapter } from "./langy-agent";
import { getSessionCookie } from "./trpc";
import {
  type ObservedAction,
  type PageActionLog,
  watchPageUiActions,
} from "./workbench-page-actions";
import {
  type ExecuteStreamRecorder,
  filledCellsOnPage,
  recordExecuteStreams,
  runColumnOnPage,
  type WorkbenchPageRun,
} from "./workbench-page-runs";

const PAGE_READY_TIMEOUT_MS = 60_000;

export interface WorkbenchPage {
  /** Every `ui` entry the turn stream carried while the page was open. */
  readonly seenActions: readonly { actionId: string; kind: string }[];
  /** Every action the page claimed, in the order the stream carried them. */
  readonly claimedActions: readonly ObservedAction[];
  /** Every action the page did not claim, with how long it had. */
  readonly droppedActions: readonly ObservedAction[];
  /** Every run this page's run buttons started, in order. */
  readonly runs: readonly WorkbenchPageRun[];
  /** How many rows of one column show an output. */
  filledCells(targetId: string): Promise<number>;
  /** Press one column's run button and wait for its whole stream. */
  runColumn(targetId: string): Promise<WorkbenchPageRun>;
  /** Detach from the conversation and close the browser. Safe to call twice. */
  close(): Promise<void>;
}

function workbenchUrl(experimentSlug: string): string {
  return `${APP_BASE}/${CONFIG.PROJECT_SLUG}/experiments/workbench/${experimentSlug}`;
}

/** The session cookie `trpc.ts` holds, as the browser context takes it. */
function sessionCookieFor(cookie: string) {
  const separator = cookie.indexOf("=");
  return {
    name: cookie.slice(0, separator),
    value: cookie.slice(separator + 1),
    url: APP_BASE,
  };
}

async function openWorkbench(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_READY_TIMEOUT_MS });
  await page.getByTestId("target-header-button").first().waitFor({
    timeout: PAGE_READY_TIMEOUT_MS,
  });
}

/** Opens the conversation in the page's panel; the page strips the parameter once it has. */
async function followConversation({
  page,
  url,
  conversationId,
}: {
  page: Page;
  url: string;
  conversationId: string;
}): Promise<void> {
  await openWorkbench(
    page,
    `${url}?${LANGY_CONVERSATION_PARAM}=${encodeURIComponent(conversationId)}`,
  );
  await page.waitForURL((address) => !address.searchParams.has(LANGY_CONVERSATION_PARAM), {
    timeout: PAGE_READY_TIMEOUT_MS,
  });
}

/** Hands the page the adapter's conversation, now or the moment the first turn opens it. */
async function attachAdapter({
  adapter,
  page,
  url,
  log,
}: {
  adapter: LangyAdapter;
  page: Page;
  url: string;
  log: PageActionLog;
}): Promise<() => void> {
  const onConversationCreated = (conversationId: string) =>
    followConversation({ page, url, conversationId });
  adapter.onUiAction = log.onStreamEntry;
  adapter.onConversationCreated = onConversationCreated;
  if (adapter.state.conversationId) {
    await followConversation({ page, url, conversationId: adapter.state.conversationId });
  }
  return () => {
    if (adapter.onUiAction === log.onStreamEntry) adapter.onUiAction = undefined;
    if (adapter.onConversationCreated === onConversationCreated) {
      adapter.onConversationCreated = undefined;
    }
  };
}

function logDrops(log: PageActionLog): void {
  // The claim window is a hard 3 second constant server-side, so a drop is a
  // timing report rather than a mystery.
  for (const action of log.droppedActions()) {
    console.log(
      `[workbench-page] ${action.kind} not claimed (${action.outcome}) after ${
        action.settledAtMs - action.seenAtMs
      }ms`,
    );
  }
}

function buildPageFacade({
  page,
  browser,
  log,
  streams,
  detach,
}: {
  page: Page;
  browser: Browser;
  log: PageActionLog;
  streams: ExecuteStreamRecorder;
  detach: () => void;
}): WorkbenchPage {
  const runs: WorkbenchPageRun[] = [];
  let closed = false;
  return {
    get seenActions() {
      return log.seenActions();
    },
    get claimedActions() {
      return log.claimedActions();
    },
    get droppedActions() {
      return log.droppedActions();
    },
    get runs() {
      return runs;
    },
    filledCells: (targetId) => filledCellsOnPage({ page, targetId }),
    runColumn: async (targetId) => {
      const run = await runColumnOnPage({ page, streams, targetId });
      runs.push(run);
      return run;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      detach();
      await log.settle();
      logDrops(log);
      await browser.close();
    },
  };
}

export async function openWorkbenchPage({
  adapter,
  experimentSlug,
}: {
  /**
   * The conversation this page's panel follows. Omitted for a page that only runs
   * columns, which is how the harness test exercises the run path without a turn.
   */
  adapter?: LangyAdapter;
  experimentSlug: string;
}): Promise<WorkbenchPage> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
    });
    await context.addCookies([sessionCookieFor(await getSessionCookie())]);
    const page = await context.newPage();
    const streams = await recordExecuteStreams(page);
    const log = watchPageUiActions(page);
    const url = workbenchUrl(experimentSlug);
    await openWorkbench(page, url);
    const detach = adapter ? await attachAdapter({ adapter, page, url, log }) : () => undefined;
    return buildPageFacade({ page, browser, log, streams, detach });
  } catch (error) {
    await browser.close();
    throw error;
  }
}
