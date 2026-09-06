/**
 * What the guided onboarding scenarios share: a fresh organization in the
 * guided variant with one project and the provider the takeover would have
 * connected, the kickoff message the tour sends when it ends, the lines the
 * skill has to say word for word, and the reads that prove what landed.
 *
 * Every file seeds its own organization, so nothing one run creates changes
 * what the next run's kickoff finds. The suite's project id follows the seed
 * (`useProject`), so the adapter, the watcher and the folder fixture all
 * address the new project without being told.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */

import { expect } from "vitest";
import {
  buildGuidedKickoffParts,
  type GuidedKickoffInput,
  type GuidedKickoffTourStatus,
} from "~/features/guided-onboarding/kickoff";
import type { GuidedPath } from "~/features/guided-onboarding/paths";
import {
  ADMIN_EMAIL,
  APP_BASE,
  PROJECT_ID,
  useAccount,
  useProject,
} from "./config";
import type { LangyAdapter, LangyToolEvent } from "./langy-agent";
import { getCliApiKey, openaiKey } from "./local-control-fixture";
import {
  getSessionCookie,
  resetSessionCookie,
  signUpAccount,
  trpcMutate,
  trpcQuery,
} from "./trpc";

// ---------------------------------------------------------------------------
// The lines the skill says verbatim (skills/guided-onboarding/SKILL.mdx)
// ---------------------------------------------------------------------------

export const GUIDED_LINES = {
  skippedTour:
    "No worries! Everything the tour covers is in the menu on the left. I'll be right here when you need me.",
  llmopsOpener:
    "Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you.",
  describeAsk: "No problem. What does your agent do? One line is enough.",
  describeConnect:
    "Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?",
  proposalStart:
    "I read through the code. I think the first scenario we should write is",
  proposalEnd: "Can I create and run it for you?",
  chatAboutThis:
    "Of course. Tell me what the scenario should cover and I'll write it with you.",
  whyScenario:
    "Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.",
  running: "Running it against your agent now.",
  proved:
    "That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.",
  allReady: "All ready! Let me know if there is anything I can help with.",
  codingOpen:
    "You're a developer, so this one is easy. Run this in any repo where you use Claude Code:",
  codingCommand: "npx langwatch claude",
  codingClose:
    "Then I can show you around once your first traces are flying through.",
  gatewayLive:
    "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:",
  gatewayClose:
    "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.",
  governanceAsk:
    "To govern anything I first need to see it. Your identity provider gives me people and teams, vendor billing exports give me the dollars, and each tool's admin API gives me seats and usage. Where should we start?",
} as const;

export const GUIDED_OPTIONS = {
  goAhead: "Sure, go ahead!",
  chatAboutThis: "Chat about this",
  identityProvider: "Connect identity provider",
  billingExport: "Connect a vendor billing export",
  describe: "I'd rather describe it",
} as const;

/** The route the governance script opens after the sources question. */
export const GOVERNANCE_SOURCES_PATH = "/governance/inventory?tab=sources";

/**
 * Whether the text carries the line, allowing for the ways a rendered reply
 * differs from its source: curly quotes, line wrapping, trailing spaces.
 */
export function saysVerbatim(text: string, line: string): boolean {
  return normalise(text).includes(normalise(line));
}

function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The judge criteria every guided conversation is held to. */
export const GUIDED_TONE_CRITERIA = [
  "Langy never asks for an API key or a provider: the brief already names one.",
  "Langy never describes the kickoff brief, the tour card or the onboarding state to the user; it simply starts the setup.",
  "Langy stays warm and brief, in the voice of a guide who is doing the work, never a manual.",
];

// ---------------------------------------------------------------------------
// The seeded organization
// ---------------------------------------------------------------------------

export interface GuidedOrganization {
  organizationId: string;
  organizationSlug: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
  orgName: string;
  /** What the value screen recorded, in pick order. */
  paths: GuidedPath[];
  currentPath: GuidedPath;
  provider: { provider: string; model: string } | null;
}

const PROVIDER = "openai";
const MODEL = "gpt-5";

/**
 * A fresh organization as the takeover leaves it: the guided variant, the
 * picks, the current path, the tour outcome, and the OpenAI provider attached
 * at organization scope as the Langy model (what the provider screen writes).
 * One project, because Langy needs one and the takeover creates one.
 *
 * The signed-in test user owns it, so every tRPC call this suite makes as
 * that user reaches it.
 */
const FRESH_ACCOUNT_PASSWORD = "GuidedRun!2026";

export async function seedGuidedOrganization({
  label,
  paths,
  currentPath = paths[0] as GuidedPath,
  donePaths = [],
  tour,
  withProvider = true,
}: {
  label: string;
  paths: GuidedPath[];
  currentPath?: GuidedPath;
  donePaths?: GuidedPath[];
  tour: GuidedKickoffTourStatus;
  withProvider?: boolean;
}): Promise<GuidedOrganization> {
  const stamp = Date.now().toString(36).slice(-5);
  // A person of their own: the organization has exactly one member, this
  // process, so no other session signed in on a shared account can land on
  // it and send the kickoff first.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await signUpAccount({
    name: `Riley ${label}`,
    email: `riley+guided-${slug}-${stamp}@acme.test`,
    password: FRESH_ACCOUNT_PASSWORD,
  });
  useAccount({
    email: `riley+guided-${slug}-${stamp}@acme.test`,
    password: FRESH_ACCOUNT_PASSWORD,
  });
  resetSessionCookie();
  const cookie = await getSessionCookie();
  const orgName = `ACME ${label} ${stamp}`;
  const now = new Date().toISOString();
  const org = await trpcMutate<{
    organization: { id: string; slug: string };
    team: { id: string; slug: string };
  }>({
    cookie,
    path: "organization.createAndAssign",
    input: {
      orgName,
      primaryIntent:
        currentPath === "governance" ? "AGENT_GOVERNANCE" : "LLM_OPS",
      signUpData: {
        terms: true,
        usage: "Company",
        onboardingVariant: "guided",
        guidedOnboarding: {
          paths,
          currentPath,
          donePaths,
          ...(withProvider ? { provider: PROVIDER, providerModel: MODEL } : {}),
          ...(tour === "completed" ? { tourCompletedAt: now } : {}),
          ...(tour === "skipped" ? { tourSkippedAt: now } : {}),
        },
      },
    },
  });
  const created = await trpcMutate<{ projectSlug: string }>({
    cookie,
    path: "project.create",
    input: {
      organizationId: org.organization.id,
      teamId: org.team.id,
      name: "ACME Checkout",
      language: "python",
      framework: "langgraph",
    },
  });
  // The create answers with the slug alone; the id comes from the
  // organization listing, the way the app resolves the ambient project.
  const organizations = await trpcQuery<
    Array<{
      id: string;
      teams?: Array<{ projects?: Array<{ id: string; slug: string }> }>;
    }>
  >({ cookie, path: "organization.getAll", input: {} });
  const project = organizations
    .find((organization) => organization.id === org.organization.id)
    ?.teams?.flatMap((team) => team.projects ?? [])
    .find((candidate) => candidate.slug === created.projectSlug);
  if (!project) {
    throw new Error(
      `project ${created.projectSlug} was created but the organization does not list it`,
    );
  }

  if (withProvider) {
    await attachProvider({
      cookie,
      organizationId: org.organization.id,
      projectId: project.id,
    });
  }

  useProject({ id: project.id, slug: project.slug });
  // The scenario library reports every simulation to the platform, and the
  // folder fixture's demo application needs a key too: both take the same
  // user key bound to this project.
  process.env.LANGWATCH_ENDPOINT = APP_BASE;
  process.env.LANGWATCH_API_KEY = await getCliApiKey();

  const seeded: GuidedOrganization = {
    organizationId: org.organization.id,
    organizationSlug: org.organization.slug,
    teamId: org.team.id,
    projectId: project.id,
    projectSlug: project.slug,
    orgName,
    paths,
    currentPath,
    provider: withProvider ? { provider: PROVIDER, model: MODEL } : null,
  };
  console.log(`[guided] seeded ${JSON.stringify(seeded)}`);
  return seeded;
}

/**
 * The provider the takeover connects: the OpenAI row at organization scope
 * with the checkout's own key, then the Langy role pointed at it, then the
 * organization's guided state told about it (`useGuidedProviderConnect`).
 */
async function attachProvider({
  cookie,
  organizationId,
  projectId,
}: {
  cookie: string;
  organizationId: string;
  projectId: string;
}): Promise<void> {
  const key = openaiKey();
  if (!key) {
    throw new Error(
      "no OPENAI_API_KEY in the environment or platform/app/.env; the seeded provider needs one",
    );
  }
  await trpcMutate({
    cookie,
    path: "modelProvider.update",
    input: {
      organizationId,
      projectId,
      provider: PROVIDER,
      enabled: true,
      customKeys: { OPENAI_API_KEY: key },
      defaultModel: MODEL,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    },
  });
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "LANGY",
      model: `${PROVIDER}/${MODEL}`,
    },
  });
  await trpcMutate({
    cookie,
    path: "onboarding.recordProvider",
    input: { organizationId, provider: PROVIDER, model: MODEL },
  });
  const resolved = await trpcQuery<unknown>({
    cookie,
    path: "modelProvider.getResolvedDefault",
    input: { projectId, featureKey: "langy" },
  });
  console.log(`[guided] langy model resolves to ${JSON.stringify(resolved)}`);
}

// ---------------------------------------------------------------------------
// The kickoff
// ---------------------------------------------------------------------------

/** The first name the takeover greets: the signed-in user's. */
async function firstNameOfTestUser(): Promise<string> {
  const cookie = await getSessionCookie();
  try {
    const session = await fetch(`${APP_BASE}/api/auth/get-session`, {
      headers: { Cookie: cookie, Origin: APP_BASE },
      signal: AbortSignal.timeout(15_000),
    }).then((res) => res.json() as Promise<{ user?: { name?: string } }>);
    const first = (session.user?.name ?? "").trim().split(/\s+/)[0];
    if (first) return first;
  } catch {
    // Fall through to the address.
  }
  return ADMIN_EMAIL.split("@")[0] ?? "there";
}

/** The kickoff input for one path, as the tour builds it from the state. */
export async function guidedKickoffInput({
  org,
  path,
  tourStatus,
}: {
  org: GuidedOrganization;
  path: GuidedPath;
  tourStatus: GuidedKickoffTourStatus;
}): Promise<GuidedKickoffInput> {
  return {
    path,
    paths: org.paths,
    ...(org.provider
      ? { provider: org.provider.provider, providerModel: org.provider.model }
      : {}),
    orgName: org.orgName,
    firstName: await firstNameOfTestUser(),
    tourStatus,
  };
}

/**
 * Queue the kickoff on the adapter, so the next `scenario.agent()` sends it.
 *
 * A first kickoff starts a fresh conversation; `continuing` sends the
 * "Let's set up {path} then." kickoff into the conversation the adapter
 * already holds, the way the Home offer does.
 */
export async function queueGuidedKickoff({
  adapter,
  org,
  path,
  tourStatus,
  continuing = false,
}: {
  adapter: LangyAdapter;
  org: GuidedOrganization;
  path: GuidedPath;
  tourStatus: GuidedKickoffTourStatus;
  continuing?: boolean;
}): Promise<GuidedKickoffInput> {
  const input = await guidedKickoffInput({ org, path, tourStatus });
  if (continuing && !adapter.state.conversationId) {
    throw new Error(
      "a continuing kickoff needs the adapter on the attached conversation",
    );
  }
  adapter.queueNextTurn({
    parts: buildGuidedKickoffParts({ input, continuing }) as unknown as Array<
      Record<string, unknown>
    >,
  });
  if (!continuing) {
    // The panel records the conversation the moment the transport names it,
    // and the fixture does the same: between the seed and that record the
    // organization owes a kickoff, and any other tab signed in on the account
    // would send one of its own.
    adapter.onConversationCreated = async (conversationId) => {
      adapter.onConversationCreated = undefined;
      await recordKickoffConversation({ org, conversationId });
    };
  }
  return input;
}

async function recordKickoffConversation({
  org,
  conversationId,
}: {
  org: GuidedOrganization;
  conversationId: string;
}): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "onboarding.attachConversation",
    input: { organizationId: org.organizationId, conversationId },
  });
}

/**
 * Record the conversation the kickoff opened on the organization, which is
 * what the panel does once the transport names it.
 */
export async function attachKickoffConversation({
  org,
  adapter,
}: {
  org: GuidedOrganization;
  adapter: LangyAdapter;
}): Promise<string> {
  const conversationId = adapter.state.conversationId;
  if (!conversationId) throw new Error("the kickoff opened no conversation");
  await recordKickoffConversation({ org, conversationId });
  return conversationId;
}

// ---------------------------------------------------------------------------
// Layer 2: what the platform holds
// ---------------------------------------------------------------------------

export interface GuidedState {
  paths: GuidedPath[];
  currentPath?: GuidedPath;
  donePaths: GuidedPath[];
  provider?: string;
  providerModel?: string;
  tourCompletedAt?: string;
  tourSkippedAt?: string;
  providerSkippedAt?: string;
  conversationId?: string;
  tourReplays?: number;
}

export async function readGuidedState(
  organizationId: string,
): Promise<GuidedState> {
  const cookie = await getSessionCookie();
  return await trpcQuery<GuidedState>({
    cookie,
    path: "onboarding.getGuidedState",
    input: { organizationId },
  });
}

/** Mark a path as begun, the way the Home offer does before its kickoff. */
export async function beginGuidedPath({
  organizationId,
  path,
}: {
  organizationId: string;
  path: GuidedPath;
}): Promise<GuidedState> {
  const cookie = await getSessionCookie();
  return await trpcMutate<GuidedState>({
    cookie,
    path: "onboarding.beginPath",
    input: { organizationId, path },
  });
}

export async function listProjectScenarios(): Promise<
  Array<{ id: string; name: string }>
> {
  const cookie = await getSessionCookie();
  return await trpcQuery<Array<{ id: string; name: string }>>({
    cookie,
    path: "scenarios.getAll",
    input: { projectId: PROJECT_ID },
  });
}

export async function listProjectSuites(): Promise<
  Array<{ id: string; name: string }>
> {
  const cookie = await getSessionCookie();
  return await trpcQuery<Array<{ id: string; name: string }>>({
    cookie,
    path: "suites.getAll",
    input: { projectId: PROJECT_ID },
  });
}

export async function listVirtualKeys(
  organizationId: string,
): Promise<Array<{ id: string; name: string }>> {
  const cookie = await getSessionCookie();
  return await trpcQuery<Array<{ id: string; name: string }>>({
    cookie,
    path: "virtualKeys.list",
    input: { organizationId },
  });
}

/** Mint the key the gateway tour mints, so Langy finds it already there. */
export async function mintVirtualKey({
  organizationId,
  projectId,
  name,
}: {
  organizationId: string;
  /** The project the key's traffic is traced into, which every key names. */
  projectId: string;
  name: string;
}): Promise<{ id: string }> {
  const cookie = await getSessionCookie();
  return await trpcMutate<{ id: string }>({
    cookie,
    path: "virtualKeys.create",
    input: {
      organizationId,
      name,
      traceProjectId: projectId,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    },
  });
}

/** The conversation's title, as the history list shows it. */
export async function conversationTitle(
  conversationId: string,
): Promise<string | null> {
  const cookie = await getSessionCookie();
  const page = await trpcQuery<{
    items: Array<{ id: string; title: string | null }>;
  }>({
    cookie,
    path: "langy.list",
    input: { projectId: PROJECT_ID, limit: 100 },
  });
  return page.items.find((item) => item.id === conversationId)?.title ?? null;
}

/** The stored conversation, as the panel rebuilds it on reload. */
export async function conversationMessages(
  conversationId: string,
): Promise<
  Array<{ id: string; role: string; parts: Array<Record<string, unknown>> }>
> {
  const cookie = await getSessionCookie();
  const snapshot = await trpcQuery<{
    messages: Array<{
      id: string;
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
  }>({
    cookie,
    path: "langy.messages",
    input: { projectId: PROJECT_ID, conversationId },
  });
  return snapshot.messages;
}

/**
 * This instance's public gateway base URL, without the /v1 suffix: what the
 * app's own snippets print, and what the gateway path's snippet has to name.
 */
export async function gatewayPublicUrl(): Promise<string> {
  const cookie = await getSessionCookie();
  const publicEnv = await trpcQuery<{ GATEWAY_BASE_URL?: string }>({
    cookie,
    path: "publicEnv",
    input: {},
  });
  const url = publicEnv.GATEWAY_BASE_URL?.replace(/\/+$/, "");
  if (!url) throw new Error("publicEnv names no GATEWAY_BASE_URL");
  return url;
}

/** The snippet points the app at this instance's gateway, never the SaaS one. */
export function expectSnippetOnThisGateway({
  text,
  gatewayUrl,
}: {
  text: string;
  gatewayUrl: string;
}): void {
  const escaped = gatewayUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(text).toMatch(new RegExp(`OPENAI_BASE_URL=["']?${escaped}/v1`));
  expect(text).not.toMatch(/gateway\.langwatch\.ai/);
}

/** Wait until the organization lists the path as done, or give up. */
export async function waitForPathDone({
  organizationId,
  path,
  timeoutMs = 120_000,
}: {
  organizationId: string;
  path: GuidedPath;
  timeoutMs?: number;
}): Promise<GuidedState> {
  const deadline = Date.now() + timeoutMs;
  let state = await readGuidedState(organizationId);
  while (!state.donePaths.includes(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    state = await readGuidedState(organizationId);
  }
  return state;
}

// ---------------------------------------------------------------------------
// When the completion ran (the stream's tool frames, not the judge)
// ---------------------------------------------------------------------------

/**
 * The tool events of several readers as one trail, in order, each frame once.
 *
 * The adapter reads the turns it starts and the watcher reads every turn of
 * the conversation, so a kickoff turn is on both and a turn the panel started
 * on its own is on the watcher alone.
 */
export function mergeToolEvents(
  ...trails: ReadonlyArray<readonly LangyToolEvent[]>
): LangyToolEvent[] {
  const seen = new Set<string>();
  const merged: LangyToolEvent[] = [];
  for (const trail of trails) {
    for (const event of trail) {
      const key = `${event.turnId}:${event.phase}:${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged;
}

/** Every `complete-path` command the trail issued, in order. */
export function pathCompletions(events: readonly LangyToolEvent[]): string[] {
  return events
    .filter(
      (event) =>
        event.phase === "start" &&
        event.command !== null &&
        /langwatch onboarding complete-path/.test(event.command),
    )
    .map((event) => event.command as string);
}

function describeTrail(events: readonly LangyToolEvent[]): string {
  return events
    .map(
      (event, index) =>
        `${index} turn ${event.turnId.slice(-6)} ${event.phase} ${event.name}${
          event.command ? ` ${event.command}` : ""
        }`,
    )
    .join("\n");
}

/**
 * The completion was the step the script reached last, not a command batched
 * into a step with other calls.
 *
 * Read on the stream's tool frames, which the worker emits the way pi runs a
 * step: every call of a step is started before any of them ends, so a
 * `complete-path` that starts while another call of its turn is still open,
 * or that has another call start before it ends, was issued in the same step
 * as that call. When the skill reached the model as a tool call (before the
 * worker placed it ahead of the brief), the completion also starts only after
 * that call settled: a completion issued before the script came back was run
 * on the words of the brief alone. `after` names commands that must have
 * settled first (the llmops path closes only once the suite run is open).
 */
export function assertPathCompletedAfterSkill({
  events,
  path,
  after = [],
}: {
  events: readonly LangyToolEvent[];
  path: GuidedPath;
  after?: readonly RegExp[];
}): void {
  const completionPattern = new RegExp(
    `langwatch onboarding complete-path ${path}\\b`,
  );
  const trail = describeTrail(events);
  const completion = events.findIndex(
    (event) =>
      event.phase === "start" &&
      event.command !== null &&
      completionPattern.test(event.command),
  );
  expect(
    completion,
    `complete-path ${path} was never issued\n${trail}`,
  ).toBeGreaterThanOrEqual(0);
  const call = events[completion]!;
  const before = events.slice(0, completion);
  const settledBefore = new Set(
    before
      .filter((event) => event.turnId === call.turnId && event.phase === "end")
      .map((event) => event.id),
  );
  const openAtStart = before.filter(
    (event) =>
      event.turnId === call.turnId &&
      event.phase === "start" &&
      !settledBefore.has(event.id),
  );
  expect(
    openAtStart.map((event) => event.name),
    `complete-path ${path} was issued in the same step as ${openAtStart
      .map((event) => event.name)
      .join(", ")}, which had not settled\n${trail}`,
  ).toEqual([]);
  const settledAt = events.findIndex(
    (event, index) =>
      index > completion && event.phase === "end" && event.id === call.id,
  );
  const startedMeanwhile = events
    .slice(completion + 1, settledAt === -1 ? undefined : settledAt)
    .filter((event) => event.turnId === call.turnId && event.phase === "start");
  expect(
    startedMeanwhile.map((event) => event.name),
    `complete-path ${path} was issued in the same step as ${startedMeanwhile
      .map((event) => event.name)
      .join(", ")}, which started before it settled\n${trail}`,
  ).toEqual([]);
  const isGuidedSkillCall = (event: LangyToolEvent) =>
    event.name === "skill" &&
    ((event.input as { name?: unknown } | null | undefined)?.name ??
      "guided-onboarding") === "guided-onboarding";
  if (events.some(isGuidedSkillCall)) {
    expect(
      before.some((event) => event.phase === "end" && isGuidedSkillCall(event)),
      `complete-path ${path} was issued before the guided-onboarding skill call settled\n${trail}`,
    ).toBe(true);
  }
  for (const pattern of after) {
    expect(
      before.some(
        (event) =>
          event.phase === "end" &&
          event.command !== null &&
          pattern.test(event.command),
      ),
      `complete-path ${path} was issued before ${pattern} settled\n${trail}`,
    ).toBe(true);
  }
}
