/**
 * What the guided onboarding scenarios share. See README.md
 * "guided-onboarding-fixture.ts" for what and why.
 * @see specs/langy/langy-guided-onboarding.feature
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  findLatestFlagshipForProvider,
  getProviderModelOptions,
} from "@langwatch/model-provider-contract";
import {
  buildGuidedKickoffParts,
  type GuidedKickoffInput,
  type GuidedKickoffTourStatus,
  GUIDED_PROVIDERS,
  type GuidedProvider,
} from "@langwatch/onboarding-browser-kit";
import type { GuidedPath } from "@langwatch/onboarding-contract";
import { expect } from "vitest";

import { APP_BASE, CONFIG, useAccount, useProject } from "./config";
import type { LangyAdapter, LangyToolEvent } from "./langy-agent";
import {
  callDemoChatRoute,
  createDemoRepo,
  type DemoRepo,
  demoProviderEnvLines,
  getCliApiKey,
  openaiKey,
  toolOutputText,
} from "./local-control-fixture";
import { getSessionCookie, resetSessionCookie, signUpAccount, trpcMutate, trpcQuery } from "./trpc";

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
    "Now that your agent is integrated, I think we should write some tests for it: scenario tests prove your agent handles the conversations it exists for, and each run is traced so you see every step. The first one I'd write is",
  pullRequestOpened: "I opened a pull request with the tracing change:",
  pullRequestMerge: "You can merge it already.",
  noRemoteStart:
    "No pull request was opened, since the folder has no remote or gh is not signed in: branch",
  // The third way step 2 can end: the push worked and the pull request command
  // failed. An error with nothing to fix, "none of the git remotes configured
  // for this repository point to a known GitHub host", is said at once; any
  // other gh error gets one fix and one retry first. The line names the branch
  // and then the one line the command printed, so only its middle is fixed.
  pushedOpenFailed: "is pushed; opening the pull request failed with:",
  branchLineStart: "I left branch",
  branchLineEnd: "checked out: the agent you started runs on it.",
  chatAboutThis: "Of course. Tell me what the scenario should cover and I'll write it with you.",
  whyScenario:
    "Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.",
  running: "Running it against your agent now.",
  proved:
    "That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.",
  allReady: "All ready! Let me know if there is anything I can help with.",
  codingOpen:
    "You're a developer, so this one is easy. Run this in any repo where you use Claude Code:",
  codingCommand: "npx langwatch claude",
  codingClose: "Then I can show you around once your first traces are flying through.",
  gatewayLive:
    "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:",
  gatewayClose:
    "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.",
  governanceLine: "Let me know if I can help you with anything! You can ask here",
} as const;

/**
 * The proposal's primary option names the scenario Langy picked, so it is a
 * shape rather than a fixed string: Create "{title}" as your first scenario
 * test.
 */
export const CREATE_FIRST_SCENARIO_OPTION = /^Create ".+" as your first scenario test$/;

/** Is this the proposal question? (README.md "guided-onboarding-fixture.ts") */
export function isProposalQuestion(question: {
  question?: string;
  options?: { label: string }[];
}): boolean {
  return (
    carriesProposalText(question) ||
    (question.options ?? []).some((option) => CREATE_FIRST_SCENARIO_OPTION.test(option.label))
  );
}

/** The lines Langy said with the say tool, in order, from the stored parts. */
export function storedSaidLines(
  messages: readonly { parts: Record<string, unknown>[] }[],
): string[] {
  return messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "tool-say")
      .map((part) => {
        const text = (part.input as { text?: unknown } | undefined)?.text;
        return typeof text === "string" ? text : "";
      }),
  );
}

/** The branch the branch line names, or null when no branch line was said. */
export function branchNamedInSaidLines(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = /I left branch `?([^`\s]+)`? checked out/.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** The manifests a package manager writes the dependency into. */
const MANIFEST_NAMES = ["pyproject.toml", "package.json"];

/**
 * Does this diff add langwatch to a manifest? The diff is split at its file
 * headers, and only the hunks of a manifest count: an import in the code is
 * not an install.
 */
export function diffAddsLangwatchToManifest(diff: string): boolean {
  return diff
    .split(/^diff --git /m)
    .filter((section) => MANIFEST_NAMES.some((name) => section.split("\n")[0]?.endsWith(name)))
    .some((section) => /^\+.*langwatch/m.test(section));
}

/** The SDK's connect call, in each language the demo repositories use. */
const SDK_CONNECT_CALLS = [/\bconnect_agent\s*\(/, /\bconnectAgent\s*\(/];

/** Does this diff add the SDK's connect call? (README.md "guided-onboarding-fixture.ts") */
export function diffAddsSdkConnect(diff: string): boolean {
  return connectCallsAdded(diff) > 0;
}

/** The lines a diff adds, without its file headers. */
function addedLines(diff: string): string[] {
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

/** How many connect calls the diff adds (README.md "guided-onboarding-fixture.ts"). */
export function connectCallsAdded(diff: string): number {
  return addedLines(diff).filter((line) => SDK_CONNECT_CALLS.some((call) => call.test(line)))
    .length;
}

/** Does this diff rewrite existing code? (README.md "guided-onboarding-fixture.ts") */
export function diffRewritesExistingCode(diff: string): string[] {
  return diff
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("-") &&
        !line.startsWith("---") &&
        /^-\s*(async def |def |export function |export default function |function |return\b)/.test(
          line,
        ),
    );
}

/** What one guided run stored, message by message. */
type StoredMessages = readonly { parts: Record<string, unknown>[] }[];

/** Every stored tool call that ran a command, in the order they ran. */
function commandCalls(messages: StoredMessages): Record<string, unknown>[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        typeof part.type === "string" &&
        part.type.startsWith("tool-") &&
        typeof (part.input as { command?: unknown } | undefined)?.command === "string",
    ),
  );
}

/** The command one stored call ran. */
function commandOf(part: Record<string, unknown>): string {
  return String((part.input as { command: string }).command);
}

/** Did a push print a new branch on a remote? (README.md "guided-onboarding-fixture.ts") */
export function pushPrintedNewRemoteBranch(messages: StoredMessages): boolean {
  return commandCalls(messages).some(
    (part) => /\bgit push\b/.test(commandOf(part)) && /\[new branch\]/.test(toolOutputText(part)),
  );
}

/** Layer 2: said lines name only what a command made (README.md "guided-onboarding-fixture.ts"). */
export function expectSaidLinesMatchRepo({
  lines,
  repo,
  messages,
}: {
  lines: readonly string[];
  repo: {
    branches: () => string[];
    remoteBranches: () => string[];
    log: () => string[];
    diffAgainstMain: (branch: string) => string;
  };
  messages: StoredMessages;
}): void {
  const branch = branchNamedInSaidLines(lines);
  expect(branch, "the branch line names a branch").not.toBeNull();
  expect(repo.branches(), "the branch line names a branch that exists").toContain(branch);
  expect(
    repo.log().some((entry) => /Add LangWatch tracing/.test(entry)),
    "the tracing commit exists",
  ).toBe(true);
  expect(
    diffAddsLangwatchToManifest(repo.diffAgainstMain(branch!)),
    "the branch adds langwatch to the manifest",
  ).toBe(true);
  expect(
    diffAddsSdkConnect(repo.diffAgainstMain(branch!)),
    "the branch adds the SDK's connect call, not a route of its own",
  ).toBe(true);
  const pullRequest = lines.find((line) => line.includes(GUIDED_LINES.pullRequestOpened));
  const noRemote = lines.find((line) => line.includes(GUIDED_LINES.noRemoteStart));
  const openFailed = lines.find((line) => line.includes(GUIDED_LINES.pushedOpenFailed));
  expect(
    [pullRequest, noRemote, openFailed].filter(Boolean).length,
    "one of the pull request line, the no-remote line and the failed-open line, never two and never none",
  ).toBe(1);
  if (pullRequest) {
    expect(pullRequest, "the pull request line carries an address").toMatch(/https?:\/\/\S+/);
    expect(pullRequest.toLowerCase()).not.toContain("no pull request");
  }
  if (noRemote) {
    expect(noRemote).toContain(branch);
    expect(
      pushPrintedNewRemoteBranch(messages),
      "the no-remote line was said, so no push printed a new branch on a remote",
    ).toBe(false);
  }
  if (openFailed) {
    expect(openFailed).toContain(branch);
    // The line says the branch is pushed, so the remote has to carry it.
    expect(repo.remoteBranches(), "the failed-open line says the branch is pushed").toContain(
      branch,
    );
    expect(
      openFailed.split(GUIDED_LINES.pushedOpenFailed)[1]?.trim(),
      "the failed-open line carries the line the command printed",
    ).toBeTruthy();
    expect(openFailed, "the failed-open line carries no pull request address").not.toMatch(
      /https?:\/\/\S+/,
    );
  }
}

/** Layer 2: the repo worked after instrumentation (README.md "guided-onboarding-fixture.ts"). */
export async function expectInstrumentationLeavesRepoWorking({
  repo,
  branch,
}: {
  repo: DemoRepo;
  branch: string;
}): Promise<void> {
  const diff = repo.diffAgainstMain(branch);
  expect(
    diffRewritesExistingCode(diff),
    "the instrumentation is added around the code that was there, so the diff removes no signature and no return",
  ).toEqual([]);
  expect(connectCallsAdded(diff), "one agent is one connect call, so one decorated function").toBe(
    1,
  );
  const answer = await callDemoChatRoute({ repo });
  expect(
    answer.unreachable,
    `the application could not be asked for a turn: ${answer.unreachable}\n${answer.lines}`,
  ).toBe("");
  expect(
    answer.status,
    `the repository's own endpoint answers on the instrumented branch, and it said:\n${answer.lines}`,
  ).toBe(200);
  expect(
    answer.output.trim(),
    "the endpoint's answer carries the output its response model declares",
  ).not.toBe("");
}

/** Layer 2: agent confirmed online first (README.md "guided-onboarding-fixture.ts"). */
export function expectAgentOnlineBeforeFirstRun(messages: StoredMessages): void {
  const calls = commandCalls(messages);
  const waitIndex = calls.findIndex((part) =>
    /langwatch agent list --wait-online/.test(commandOf(part)),
  );
  const runIndex = calls.findIndex((part) =>
    /langwatch (scenario|test-suite) run/.test(commandOf(part)),
  );
  expect(waitIndex, "agent list --wait-online ran").toBeGreaterThan(-1);
  expect(runIndex, "a run happened").toBeGreaterThan(-1);
  expect(runIndex, "the wait came before the first run").toBeGreaterThan(waitIndex);
  const wait = calls[waitIndex]!;
  const output = typeof wait.output === "string" ? wait.output : JSON.stringify(wait.output ?? "");
  expect(output, "the agent reported online").toMatch(/"status":\s*"online"/);
  expect(output).not.toMatch(/No agent named/);
}

/** Does the question's own text carry the proposal, word for word? */
export function carriesProposalText(question: { question?: string }): boolean {
  return (question.question ?? "").includes(GUIDED_LINES.proposalStart);
}

/** The create option's label on the proposal question, as Langy worded it. */
export function createFirstScenarioLabel(question: {
  options?: { label: string }[];
}): string | undefined {
  return (question.options ?? []).find((option) => CREATE_FIRST_SCENARIO_OPTION.test(option.label))
    ?.label;
}

export const GUIDED_OPTIONS = {
  chatAboutThis: "Chat about this",
  describe: "I'd rather describe it",
} as const;

/** Whether the text carries the line (README.md "guided-onboarding-fixture.ts"). */
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
  // The skipped-tour opener names the tour, and the skill requires it word
  // for word. Without the carve-out the judge is handed two criteria that
  // cannot both hold, and which one wins is a coin flip.
  "Langy never describes the kickoff brief, the tour card or the onboarding state to the user in its own words; it simply starts the setup. A line Langy is required to say word for word does not count, whatever it mentions.",
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

/** The provider the seeded org connects (README.md "guided-onboarding-fixture.ts"). */
const PROVIDER = (process.env.LANGY_GUIDED_PROVIDER ?? "openai") as GuidedProvider["id"];

const AZURE_API_VERSION = process.env.AZURE_API_VERSION ?? "2024-10-21";

/** The model LANGY answers from, not the org's (README.md "guided-onboarding-fixture.ts"). */
const LANGY_MODEL = process.env.LANGY_MODEL ?? "";

/** The model the harness's judge and simulator use when the provider is OpenAI. */
const HARNESS_OPENAI_MODEL = "gpt-5-mini";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required with LANGY_GUIDED_PROVIDER=${PROVIDER}; the run script exports it from the workspace-root .env`,
    );
  }
  return value;
}

const azureBaseUrl = (): string => `https://${requiredEnv("AZURE_RESOURCE_NAME")}.openai.azure.com`;

/** The harness's simulator/judge model (README.md "guided-onboarding-fixture.ts"). */
export function guidedHarnessModel() {
  if (PROVIDER === "azure") {
    return createOpenAICompatible({
      name: "azure",
      baseURL: `${azureBaseUrl()}/openai/deployments/${MODEL}`,
      headers: { "api-key": requiredEnv("AZURE_API_KEY") },
      queryParams: { "api-version": AZURE_API_VERSION },
    })(MODEL);
  }
  if (PROVIDER !== "openai") {
    throw new Error(
      `LANGY_GUIDED_PROVIDER=${PROVIDER} has no harness model here; this suite carries @ai-sdk/openai and @ai-sdk/openai-compatible only`,
    );
  }
  return openai(HARNESS_OPENAI_MODEL);
}

/** At most this many chat model pills: the recommended one and the next few. */
const GUIDED_MODEL_PILLS_MAX = 4;

/** Chat model pills, real catalog (README.md "guided-onboarding-fixture.ts"). */
function guidedChatModels(provider: GuidedProvider): string[] {
  const backend = provider.registryKey === "openai_codex" ? "openai" : provider.registryKey;
  const catalog = getProviderModelOptions(backend, "chat").map((option) => option.value);
  const recommended = findLatestFlagshipForProvider(backend, "chat")[0]?.slice(backend.length + 1);
  const ordered = recommended
    ? [recommended, ...catalog.filter((m) => m !== recommended)]
    : catalog;
  return ordered.slice(0, GUIDED_MODEL_PILLS_MAX);
}

/** The model the provider screen lands on (README.md "guided-onboarding-fixture.ts"). */
const MODEL =
  PROVIDER === "azure"
    ? requiredEnv("AZURE_DEPLOYMENT")
    : guidedChatModels(GUIDED_PROVIDERS.find((provider) => provider.id === PROVIDER)!)[0]!;

/** A fresh organization as the takeover leaves it (README.md "guided-onboarding-fixture.ts"). */
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
      primaryIntent: currentPath === "governance" ? "AGENT_GOVERNANCE" : "LLM_OPS",
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
    {
      id: string;
      teams?: { projects?: { id: string; slug: string }[] }[];
    }[]
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

/** The provider the takeover connects (README.md "guided-onboarding-fixture.ts"). */
async function attachProvider({
  cookie,
  organizationId,
  projectId,
}: {
  cookie: string;
  organizationId: string;
  projectId: string;
}): Promise<void> {
  let customKeys: Record<string, string>;
  if (PROVIDER === "azure") {
    customKeys = {
      AZURE_OPENAI_ENDPOINT: azureBaseUrl(),
      AZURE_OPENAI_API_KEY: requiredEnv("AZURE_API_KEY"),
    };
  } else {
    const key = openaiKey();
    if (!key) {
      throw new Error(
        "no OPENAI_API_KEY in the environment or the workspace-root .env; the seeded provider needs one",
      );
    }
    customKeys = { OPENAI_API_KEY: key };
  }
  await trpcMutate({
    cookie,
    path: "modelProvider.update",
    input: {
      organizationId,
      projectId,
      provider: PROVIDER,
      enabled: true,
      customKeys,
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
  // Everything not Langy runs on DEFAULT (README.md "guided-onboarding-fixture.ts").
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "DEFAULT",
      model: `${PROVIDER}/${MODEL}`,
    },
  });
  await trpcMutate({
    cookie,
    path: "onboarding.recordProvider",
    input: { organizationId, provider: PROVIDER, model: MODEL },
  });
  if (LANGY_MODEL) await pointLangyAt({ cookie, organizationId });
  // Both keys, different questions (README.md "guided-onboarding-fixture.ts").
  for (const featureKey of ["langy", "scenarios.user_simulator"]) {
    const resolved = await trpcQuery<unknown>({
      cookie,
      path: "modelProvider.getResolvedDefault",
      input: { projectId, featureKey },
    });
    console.log(`[guided] ${featureKey} resolves to ${JSON.stringify(resolved)}`);
  }
}

/** Gives the org the provider behind LANGY_MODEL (README.md "guided-onboarding-fixture.ts"). */
async function pointLangyAt({
  cookie,
  organizationId,
}: {
  cookie: string;
  organizationId: string;
}): Promise<void> {
  const provider = LANGY_MODEL.split("/")[0] ?? "";
  if (!provider) {
    throw new Error(`LANGY_MODEL=${LANGY_MODEL} is not provider/model`);
  }
  copyProviderRow({ provider, organizationId });
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "LANGY",
      model: LANGY_MODEL,
    },
  });
  console.log(`[guided] langy answers from ${LANGY_MODEL}`);
}

/** Where the copy reads from and writes to. */
const PG_URL = process.env.LANGWATCH_PG_URL ?? "postgresql://postgres@localhost:5432/langwatch_db";

/** Copies a signed-in provider row, once (README.md "guided-onboarding-fixture.ts"). */
function copyProviderRow({
  provider,
  organizationId,
}: {
  provider: string;
  organizationId: string;
}): void {
  const psql = (sql: string): string =>
    execFileSync("psql", [PG_URL, "-t", "-A", "-c", sql], {
      encoding: "utf8",
      timeout: 60_000,
    }).trim();

  const already = psql(
    `select id from langwatch_db."ModelProvider"
     where provider = '${provider}' and "organizationId" = '${organizationId}' limit 1`,
  );
  if (already) return;

  const source = psql(
    `select id from langwatch_db."ModelProvider"
     where provider = '${provider}' and enabled
     order by "createdAt" desc limit 1`,
  );
  if (!source) {
    throw new Error(
      `no enabled ${provider} row in this database; sign it in once on any organization first`,
    );
  }

  const suffix = Math.random().toString(36).slice(2, 10);
  psql(
    `insert into langwatch_db."ModelProvider"
       (id, provider, enabled, "customKeys", "deploymentMapping", "customModels",
        "customEmbeddingsModels", "extraHeaders", name, "providerConfig",
        "organizationId", "createdAt", "updatedAt")
     select 'provider_copy_${suffix}', provider, true, "customKeys",
            "deploymentMapping", "customModels", "customEmbeddingsModels",
            "extraHeaders", name, "providerConfig", '${organizationId}',
            now(), now()
     from langwatch_db."ModelProvider" where id = '${source}'`,
  );
  psql(
    `insert into langwatch_db."ModelProviderScope"
       (id, "modelProviderId", "scopeType", "scopeId", "createdAt")
     values ('mpscope_copy_${suffix}', 'provider_copy_${suffix}',
             'ORGANIZATION', '${organizationId}', now())`,
  );
  console.log(`[guided] copied a ${provider} row into ${organizationId}`);
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
  } catch (error) {
    console.debug(`[fixture] session read failed, falling back to the address: ${String(error)}`);
  }
  return CONFIG.ADMIN_EMAIL.split("@")[0] ?? "there";
}

/** Which guided state the kickoff is composed from (README.md "guided-onboarding-fixture.ts"). */
export type GuidedKickoffSnapshot = "current" | "before-the-key";

/** The kickoff input for one path, as the tour builds it from the state. */
export async function guidedKickoffInput({
  org,
  path,
  tourStatus,
  snapshot = "current",
}: {
  org: GuidedOrganization;
  path: GuidedPath;
  tourStatus: GuidedKickoffTourStatus;
  snapshot?: GuidedKickoffSnapshot;
}): Promise<GuidedKickoffInput> {
  const state = await readGuidedState(org.organizationId);
  const fields = pickKickoffStateFields(state);
  return {
    path,
    paths: org.paths,
    ...(org.provider ? { provider: org.provider.provider, providerModel: org.provider.model } : {}),
    orgName: org.orgName,
    firstName: await firstNameOfTestUser(),
    tourStatus,
    // Gateway/Virtual-key lines (README.md "guided-onboarding-fixture.ts").
    ...(snapshot === "before-the-key" ? { gatewayUrl: fields.gatewayUrl } : fields),
  };
}

function pickKickoffStateFields(
  state: GuidedState,
): Pick<
  GuidedKickoffInput,
  "gatewayUrl" | "virtualKeyName" | "virtualKeyPreview" | "virtualKeyRevealId"
> {
  return {
    gatewayUrl: state.gatewayUrl,
    virtualKeyName: state.virtualKeyName,
    virtualKeyPreview: state.virtualKeyPreview,
    virtualKeyRevealId: state.virtualKeyRevealId,
  };
}

/** Queues the kickoff on the adapter (README.md "guided-onboarding-fixture.ts"). */
export async function queueGuidedKickoff({
  adapter,
  org,
  path,
  tourStatus,
  continuing = false,
  snapshot = "current",
}: {
  adapter: LangyAdapter;
  org: GuidedOrganization;
  path: GuidedPath;
  tourStatus: GuidedKickoffTourStatus;
  continuing?: boolean;
  snapshot?: GuidedKickoffSnapshot;
}): Promise<GuidedKickoffInput> {
  const input = await guidedKickoffInput({ org, path, tourStatus, snapshot });
  if (continuing && !adapter.state.conversationId) {
    throw new Error("a continuing kickoff needs the adapter on the attached conversation");
  }
  adapter.queueNextTurn({ parts: buildGuidedKickoffParts({ input, continuing }) });
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
  /** The gateway URL an app on this instance points at, with its /v1. */
  gatewayUrl?: string;
  /** The key the tour minted, named for Langy by its one-time reveal id. */
  virtualKeyName?: string;
  virtualKeyPreview?: string;
  virtualKeyRevealId?: string;
}

export async function readGuidedState(organizationId: string): Promise<GuidedState> {
  const cookie = await getSessionCookie();
  return trpcQuery<GuidedState>({
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
  return trpcMutate<GuidedState>({
    cookie,
    path: "onboarding.beginPath",
    input: { organizationId, path },
  });
}

export async function listProjectScenarios(): Promise<{ id: string; name: string }[]> {
  const cookie = await getSessionCookie();
  return trpcQuery<{ id: string; name: string }[]>({
    cookie,
    path: "scenarios.getAll",
    input: { projectId: CONFIG.PROJECT_ID },
  });
}

export async function listProjectSuites(): Promise<{ id: string; name: string }[]> {
  const cookie = await getSessionCookie();
  return trpcQuery<{ id: string; name: string }[]>({
    cookie,
    path: "suites.getAll",
    input: { projectId: CONFIG.PROJECT_ID },
  });
}

export async function listVirtualKeys(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  const cookie = await getSessionCookie();
  return trpcQuery<{ id: string; name: string }[]>({
    cookie,
    path: "virtualKeys.list",
    input: { organizationId },
  });
}

/**
 * Mint the key the gateway tour mints, so Langy finds it already there, and
 * record it on the guided state the way the tour's drawer does: by its
 * one-time reveal id, never by its secret.
 */
export async function mintVirtualKey({
  organizationId,
  projectId,
  name,
}: {
  organizationId: string;
  /** The project the key's traffic is traced into, which every key names. */
  projectId: string;
  name: string;
}): Promise<{ id: string; preview: string; revealId: string }> {
  const cookie = await getSessionCookie();
  const created = await trpcMutate<{
    virtualKey: { id: string; name: string };
    preview: string;
    revealId: string;
  }>({
    cookie,
    path: "virtualKeys.create",
    input: {
      organizationId,
      name,
      traceProjectId: projectId,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      revealOnce: true,
    },
  });
  await trpcMutate({
    cookie,
    path: "onboarding.recordVirtualKeyReveal",
    input: {
      organizationId,
      name: created.virtualKey.name,
      preview: created.preview,
      revealId: created.revealId,
    },
  });
  return {
    id: created.virtualKey.id,
    preview: created.preview,
    revealId: created.revealId,
  };
}

/** The secret snippet calls a run made, as the stream reported their input. */
export function secretSnippetCalls(
  events: LangyToolEvent[],
): { revealId: string; template: string; preview?: string }[] {
  return events
    .filter((event) => event.phase === "start" && event.name === "secret_snippet")
    .map((event) => event.input as Record<string, unknown> | null)
    .filter(
      (input): input is { revealId: string; template: string; preview?: string } =>
        typeof input?.revealId === "string" && typeof input?.template === "string",
    );
}

/**
 * The snippet Langy handed to the secret snippet card points at this
 * instance's gateway and leaves the key to the card.
 */
export function expectSecretSnippetOnThisGateway({
  events,
  gatewayUrl,
  revealId,
}: {
  events: LangyToolEvent[];
  gatewayUrl: string;
  /** The reveal id the brief named, when the tour minted the key. */
  revealId?: string;
}): void {
  const calls = secretSnippetCalls(events);
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  const escaped = gatewayUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The address ends at /v1: a sentence's full stop copied from the brief
  // into the quotes would give the user an invalid base URL.
  expect(call.template).toMatch(new RegExp(`OPENAI_BASE_URL=["']?${escaped}/v1["']?(\\s|$)`, "m"));
  expect(call.template).not.toMatch(new RegExp(`${escaped}/v1\\.`));
  expect(call.template).not.toMatch(/gateway\.langwatch\.ai/);
  expect(call.template).toMatch(/OPENAI_API_KEY=["']?\{\{secret\}\}/);
  expect(call.template).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
  expect(call.revealId).toMatch(/^rvl_/);
  if (revealId) expect(call.revealId).toBe(revealId);
}

/** No message Langy wrote carries a virtual key secret. */
export function expectNoSecretInText(text: string): void {
  expect(text).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
}

/** The conversation's title, as the history list shows it. */
export async function conversationTitle(conversationId: string): Promise<string | null> {
  const cookie = await getSessionCookie();
  const page = await trpcQuery<{
    items: { id: string; title: string | null }[];
  }>({
    cookie,
    path: "langy.list",
    input: { projectId: CONFIG.PROJECT_ID, limit: 100 },
  });
  return page.items.find((item) => item.id === conversationId)?.title ?? null;
}

/** The stored conversation, as the panel rebuilds it on reload. */
export async function conversationMessages(
  conversationId: string,
): Promise<{ id: string; role: string; parts: Record<string, unknown>[] }[]> {
  const cookie = await getSessionCookie();
  const snapshot = await trpcQuery<{
    messages: {
      id: string;
      role: string;
      parts: Record<string, unknown>[];
    }[];
  }>({
    cookie,
    path: "langy.messages",
    input: { projectId: CONFIG.PROJECT_ID, conversationId },
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

/** The developer's checkout as they share it (README.md "guided-onboarding-fixture.ts"). */
export async function createGuidedCheckout({ name }: { name: string }): Promise<DemoRepo> {
  const repo = await createDemoRepo({ language: "langgraph", name });
  await fs.writeFile(
    path.join(repo.root, ".env"),
    `${demoProviderEnvLines().join("\n")}\n`,
    "utf8",
  );
  return repo;
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

/** Several readers' events, one trail (README.md "guided-onboarding-fixture.ts"). */
export function mergeToolEvents(
  ...trails: readonly (readonly LangyToolEvent[])[]
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

/** The completion was the last step, not batched (README.md "guided-onboarding-fixture.ts"). */
export function assertPathCompletedAfterSkill({
  events,
  path,
  after = [],
}: {
  events: readonly LangyToolEvent[];
  path: GuidedPath;
  after?: readonly RegExp[];
}): void {
  const completionPattern = new RegExp(`langwatch onboarding complete-path ${path}\\b`);
  const trail = describeTrail(events);
  const completion = events.findIndex(
    (event) =>
      event.phase === "start" && event.command !== null && completionPattern.test(event.command),
  );
  expect(completion, `complete-path ${path} was never issued\n${trail}`).toBeGreaterThanOrEqual(0);
  const call = events[completion]!;
  const before = events.slice(0, completion);
  const settledBefore = new Set(
    before
      .filter((event) => event.turnId === call.turnId && event.phase === "end")
      .map((event) => event.id),
  );
  const openAtStart = before.filter(
    (event) =>
      event.turnId === call.turnId && event.phase === "start" && !settledBefore.has(event.id),
  );
  expect(
    openAtStart.map((event) => event.name),
    `complete-path ${path} was issued in the same step as ${openAtStart
      .map((event) => event.name)
      .join(", ")}, which had not settled\n${trail}`,
  ).toEqual([]);
  const settledAt = events.findIndex(
    (event, index) => index > completion && event.phase === "end" && event.id === call.id,
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
    ((event.input as { name?: unknown } | null | undefined)?.name ?? "guided-onboarding") ===
      "guided-onboarding";
  if (events.some(isGuidedSkillCall)) {
    expect(
      before.some((event) => event.phase === "end" && isGuidedSkillCall(event)),
      `complete-path ${path} was issued before the guided-onboarding skill call settled\n${trail}`,
    ).toBe(true);
  }
  for (const pattern of after) {
    expect(
      before.some(
        (event) => event.phase === "end" && event.command !== null && pattern.test(event.command),
      ),
      `complete-path ${path} was issued before ${pattern} settled\n${trail}`,
    ).toBe(true);
  }
}
