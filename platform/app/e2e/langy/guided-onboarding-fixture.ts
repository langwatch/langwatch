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

import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { expect } from "vitest";
import {
  buildGuidedKickoffParts,
  type GuidedKickoffInput,
  type GuidedKickoffTourStatus,
} from "~/features/guided-onboarding/kickoff";
import type { GuidedPath } from "~/features/guided-onboarding/paths";
import {
  GUIDED_PROVIDERS,
  type GuidedProvider,
  guidedChatModels,
} from "~/features/guided-onboarding/takeover/providers";
import {
  ADMIN_EMAIL,
  APP_BASE,
  PROJECT_ID,
  useAccount,
  useProject,
} from "./config";
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
  governanceLine:
    "Let me know if I can help you with anything! You can ask here",
} as const;

/**
 * The proposal's primary option names the scenario Langy picked, so it is a
 * shape rather than a fixed string: Create "{title}" as your first scenario
 * test.
 */
export const CREATE_FIRST_SCENARIO_OPTION =
  /^Create ".+" as your first scenario test$/;

/**
 * Is this the proposal question: the bare question whose own text is the
 * proposal and whose first option creates the scenario? Either mark finds it,
 * so a run that got the words right but not the option, or the other way
 * round, still lands on the assertions that say which.
 */
export function isProposalQuestion(question: {
  question?: string;
  options?: Array<{ label: string }>;
}): boolean {
  return (
    carriesProposalText(question) ||
    (question.options ?? []).some((option) =>
      CREATE_FIRST_SCENARIO_OPTION.test(option.label),
    )
  );
}

/** The lines Langy said with the say tool, in order, from the stored parts. */
export function storedSaidLines(
  messages: ReadonlyArray<{ parts: Array<Record<string, unknown>> }>,
): string[] {
  return messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "tool-say")
      .map((part) =>
        String((part.input as { text?: unknown } | undefined)?.text ?? ""),
      ),
  );
}

/** The branch the branch line names, or null when no branch line was said. */
export function branchNamedInSaidLines(
  lines: readonly string[],
): string | null {
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
    .filter((section) =>
      MANIFEST_NAMES.some((name) => section.split("\n")[0]?.endsWith(name)),
    )
    .some((section) => /^\+.*langwatch/m.test(section));
}

/** The SDK's connect call, in each language the demo repositories use. */
const SDK_CONNECT_CALLS = [/\bconnect_agent\s*\(/, /\bconnectAgent\s*\(/];

/**
 * Does this diff add the SDK's connect call?
 *
 * The connect-agent skill's HTTP fallback is for an agent that cannot import
 * the SDK, and a run took that shape with the SDK installed: it left a route
 * answering on `/langwatch/connect`. A route registers nothing, so the process
 * starts cleanly and no agent ever reports online. Only the SDK's own call
 * opens the connection.
 */
export function diffAddsSdkConnect(diff: string): boolean {
  return connectCallsAdded(diff) > 0;
}

/** The lines a diff adds, without its file headers. */
function addedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

/**
 * How many connect calls the diff adds.
 *
 * One agent is one connect call, so one decorated function. A run decorated
 * the entry point and then a wrapper around it with the same agent name, and
 * the SDK said so on startup: "acme-checkout@development was declared twice,
 * the last declaration wins".
 */
export function connectCallsAdded(diff: string): number {
  return addedLines(diff).filter((line) =>
    SDK_CONNECT_CALLS.some((call) => call.test(line)),
  ).length;
}

/**
 * Does this diff rewrite code the repository already had?
 *
 * Instrumentation is added around what is there: a new function that wraps the
 * entry point, an import, a decorator line. A run instead decorated `run_turn`
 * itself and changed its return from the dictionary `app/main.py` reads to a
 * string, so the repository's own route raised on the result of its only call.
 * A signature or a return that changed is a removed `def` or `return` line in
 * the diff, which is what this reads: adding lines never removes one.
 */
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
type StoredMessages = ReadonlyArray<{ parts: Array<Record<string, unknown>> }>;

/** Every stored tool call that ran a command, in the order they ran. */
function commandCalls(
  messages: StoredMessages,
): Array<Record<string, unknown>> {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        typeof part.type === "string" &&
        part.type.startsWith("tool-") &&
        typeof (part.input as { command?: unknown } | undefined)?.command ===
          "string",
    ),
  );
}

/** The command one stored call ran. */
function commandOf(part: Record<string, unknown>): string {
  return String((part.input as { command: string }).command);
}

/**
 * Did a push print a new branch on a remote?
 *
 * The no-remote line is for a folder with no remote, or a `gh` that is not
 * signed in. A run said it right after a push that printed `* [new branch]`,
 * where the pull request had failed on a body file Langy never wrote, so the
 * sentence named a cause nothing had shown.
 */
export function pushPrintedNewRemoteBranch(messages: StoredMessages): boolean {
  return commandCalls(messages).some(
    (part) =>
      /\bgit push\b/.test(commandOf(part)) &&
      /\[new branch\]/.test(toolOutputText(part)),
  );
}

/**
 * Layer 2: every branch, commit and pull request the said lines name is a
 * thing a command made, and the branch carries the install. A run once pasted
 * the no-remote sentence into the brace of the pull request line and named a
 * branch no command had created; another wrote the import without ever
 * installing the package, so the agent died at import; a third wrote a route
 * where the SDK's connect call belongs and said the no-remote line after a
 * push that had just created the branch on the remote.
 *
 * Step 2 ends on one of three lines: the pull request line with the address
 * the command printed, the no-remote line, or the failed-open line, which says
 * the branch is pushed and carries the line the command printed.
 */
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
  expect(
    repo.branches(),
    "the branch line names a branch that exists",
  ).toContain(branch);
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
  const pullRequest = lines.find((line) =>
    line.includes(GUIDED_LINES.pullRequestOpened),
  );
  const noRemote = lines.find((line) =>
    line.includes(GUIDED_LINES.noRemoteStart),
  );
  const openFailed = lines.find((line) =>
    line.includes(GUIDED_LINES.pushedOpenFailed),
  );
  expect(
    [pullRequest, noRemote, openFailed].filter(Boolean).length,
    "one of the pull request line, the no-remote line and the failed-open line, never two and never none",
  ).toBe(1);
  if (pullRequest) {
    expect(pullRequest, "the pull request line carries an address").toMatch(
      /https?:\/\/\S+/,
    );
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
    expect(
      repo.remoteBranches(),
      "the failed-open line says the branch is pushed",
    ).toContain(branch);
    expect(
      openFailed.split(GUIDED_LINES.pushedOpenFailed)[1]?.trim(),
      "the failed-open line carries the line the command printed",
    ).toBeTruthy();
    expect(
      openFailed,
      "the failed-open line carries no pull request address",
    ).not.toMatch(/https?:\/\/\S+/);
  }
}

/**
 * Layer 2: the instrumentation left the repository working.
 *
 * The diff is read for the shape the skill asks for, a new function around
 * what is there, and then the application's own endpoint is asked for a turn
 * from the branch Langy left checked out. The endpoint is the part the
 * scenarios never touch: they reach the agent through the SDK's connection, so
 * a run once passed every check with a `POST /chat` that raised on the first
 * request.
 */
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
  expect(
    connectCallsAdded(diff),
    "one agent is one connect call, so one decorated function",
  ).toBe(1);
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

/**
 * Layer 2: the agent was confirmed online, through one agent list
 * --wait-online call that answered online, before the first run.
 */
export function expectAgentOnlineBeforeFirstRun(
  messages: StoredMessages,
): void {
  const calls = commandCalls(messages);
  const waitIndex = calls.findIndex((part) =>
    /langwatch agent list --wait-online/.test(commandOf(part)),
  );
  const runIndex = calls.findIndex((part) =>
    /langwatch (scenario|test-suite) run/.test(commandOf(part)),
  );
  expect(waitIndex, "agent list --wait-online ran").toBeGreaterThan(-1);
  expect(runIndex, "a run happened").toBeGreaterThan(-1);
  expect(runIndex, "the wait came before the first run").toBeGreaterThan(
    waitIndex,
  );
  const wait = calls[waitIndex]!;
  const output =
    typeof wait.output === "string"
      ? wait.output
      : JSON.stringify(wait.output ?? "");
  expect(output, "the agent reported online").toMatch(/"status":\s*"online"/);
  expect(output).not.toMatch(/No agent named/);
}

/** Does the question's own text carry the proposal, word for word? */
export function carriesProposalText(question: { question?: string }): boolean {
  return (question.question ?? "").includes(GUIDED_LINES.proposalStart);
}

/** The create option's label on the proposal question, as Langy worded it. */
export function createFirstScenarioLabel(question: {
  options?: Array<{ label: string }>;
}): string | undefined {
  return (question.options ?? []).find((option) =>
    CREATE_FIRST_SCENARIO_OPTION.test(option.label),
  )?.label;
}

export const GUIDED_OPTIONS = {
  chatAboutThis: "Chat about this",
  describe: "I'd rather describe it",
} as const;

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

/**
 * The provider the seeded organization connects, and the one the harness's own
 * judge and simulator answer from. The committed default is OpenAI; a run moves
 * both onto another provider by setting LANGY_GUIDED_PROVIDER, so no file has
 * to change when an account runs out of credit.
 *
 * Azure names a model by its deployment, so AZURE_DEPLOYMENT is both the model
 * the takeover types and the deployment the harness calls.
 */
const PROVIDER = (process.env.LANGY_GUIDED_PROVIDER ??
  "openai") as GuidedProvider["id"];

const AZURE_API_VERSION = process.env.AZURE_API_VERSION ?? "2024-10-21";

/**
 * The model LANGY itself answers from, when that is not the provider the
 * organization connected. `provider/model`, empty for the ordinary case.
 *
 * LANGY_GUIDED_PROVIDER moves four things at once: the provider the takeover
 * connects, the judge, the simulator and the demo application. Which model
 * Langy is capable enough on is a different question, and answering it by
 * moving all four would move the judge too and make the verdicts
 * incomparable. This moves the one role and leaves the rest where they are.
 *
 * A provider that signs in rather than takes a key (Codex is a ChatGPT login)
 * cannot be re-typed by a run: the token set is stored encrypted and tRPC
 * hands it back masked. Such a row is copied in the database instead, from a
 * row that is already signed in; the ciphertext stays ciphertext and nothing
 * about the tokens is read, printed or written outside it.
 */
const LANGY_MODEL = process.env.LANGY_MODEL ?? "";

/** The model the harness's judge and simulator use when the provider is OpenAI. */
const HARNESS_OPENAI_MODEL = "gpt-5-mini";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required with LANGY_GUIDED_PROVIDER=${PROVIDER}; the run script exports it from platform/app/.env`,
    );
  }
  return value;
}

const azureBaseUrl = (): string =>
  `https://${requiredEnv("AZURE_RESOURCE_NAME")}.openai.azure.com`;

/**
 * The model the scenario harness runs its simulator and its judge on, which is
 * the same model the seeded organization gives Langy.
 *
 * Azure goes through the OpenAI-compatible provider rather than @ai-sdk/azure,
 * which this checkout does not carry: the deployment is in the base URL, the
 * key is a header and the API version is a query parameter.
 */
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
      `LANGY_GUIDED_PROVIDER=${PROVIDER} has no harness model here; platform/app carries @ai-sdk/openai and @ai-sdk/openai-compatible only`,
    );
  }
  return openai(HARNESS_OPENAI_MODEL);
}

/**
 * The model the guided provider screen lands on for OpenAI, resolved the way
 * the screen resolves it: it preselects the first chat pill, and the first
 * pill is the registry's recommended model.
 *
 * A literal here pinned the suite to a model the product had stopped using,
 * and the gateway path then passed every run while the live path failed every
 * run, because the skill's wording convinced one model and not the other.
 */
const MODEL =
  PROVIDER === "azure"
    ? requiredEnv("AZURE_DEPLOYMENT")
    : guidedChatModels(
        GUIDED_PROVIDERS.find((provider) => provider.id === PROVIDER)!,
      )[0]!;

/**
 * A fresh organization as the takeover leaves it: the guided variant, the
 * picks, the current path, the tour outcome, and the provider attached at
 * organization scope as the Langy model (what the provider screen writes).
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
 * The provider the takeover connects: its row at organization scope with the
 * checkout's own credentials, then the Langy role pointed at it, then the
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
        "no OPENAI_API_KEY in the environment or platform/app/.env; the seeded provider needs one",
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
  // Everything that is not Langy runs on the DEFAULT role: the scenario user
  // simulator, the judge, the evaluations. A role nothing covers does not fall
  // back to the one provider the organization has, it raises
  // ModelNotConfiguredError, so a path that gets all the way to running its
  // first scenario fails there with the agent online and the scenario written.
  // A real connect ends up with this key because the form's save seeds the
  // roles for the provider; seeding through the API has to write it.
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
  // Both keys, because they answer different questions: langy is who writes
  // the path, and the user simulator is what a scenario run needs before it
  // can start. A run that reaches its first scenario and finds no simulator
  // model fails there, long after the seeding that caused it.
  for (const featureKey of ["langy", "scenarios.user_simulator"]) {
    const resolved = await trpcQuery<unknown>({
      cookie,
      path: "modelProvider.getResolvedDefault",
      input: { projectId, featureKey },
    });
    console.log(
      `[guided] ${featureKey} resolves to ${JSON.stringify(resolved)}`,
    );
  }
}

/**
 * Give the organization the provider behind LANGY_MODEL and point the Langy
 * role at it, leaving the connected provider, the judge and the simulator on
 * whatever LANGY_GUIDED_PROVIDER chose.
 */
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
const PG_URL =
  process.env.LANGWATCH_PG_URL ??
  "postgresql://postgres@localhost:5432/langwatch_db";

/**
 * Copy a signed-in provider row into this organization, once.
 *
 * Only for a provider a run cannot re-type: the credentials column is
 * ciphertext and is copied as ciphertext, never selected into a log.
 */
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
  } catch {
    // Fall through to the address.
  }
  return ADMIN_EMAIL.split("@")[0] ?? "there";
}

/** The kickoff input for one path, as the tour builds it from the state. */
/**
 * Which guided state the kickoff is composed from. "current" reads it after
 * everything the test seeded, so the brief carries the key the tour minted.
 * "before-the-key" is what the panel sends live: the tour records the key
 * seconds before it ends, the host composes from the state it still holds,
 * and the brief says none was minted. The server settles that kickoff from
 * the stored state; this is the snapshot that proves it does.
 */
export type GuidedKickoffSnapshot = "current" | "before-the-key";

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
    ...(org.provider
      ? { provider: org.provider.provider, providerModel: org.provider.model }
      : {}),
    orgName: org.orgName,
    firstName: await firstNameOfTestUser(),
    tourStatus,
    // The Gateway and Virtual key lines: the host takes both from the guided
    // state, where the instance names the address an app on it points at and
    // the tour records the key it minted. The snapshot from before the key
    // keeps the address and drops the key, which is what the host held then.
    ...(snapshot === "before-the-key"
      ? { gatewayUrl: fields.gatewayUrl }
      : fields),
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
  /** The gateway URL an app on this instance points at, with its /v1. */
  gatewayUrl?: string;
  /** The key the tour minted, named for Langy by its one-time reveal id. */
  virtualKeyName?: string;
  virtualKeyPreview?: string;
  virtualKeyRevealId?: string;
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
): Array<{ revealId: string; template: string; preview?: string }> {
  return events
    .filter(
      (event) => event.phase === "start" && event.name === "secret_snippet",
    )
    .map((event) => event.input as Record<string, unknown> | null)
    .filter(
      (
        input,
      ): input is { revealId: string; template: string; preview?: string } =>
        typeof input?.revealId === "string" &&
        typeof input?.template === "string",
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
  expect(call.template).toMatch(
    new RegExp(`OPENAI_BASE_URL=["']?${escaped}/v1["']?(\\s|$)`, "m"),
  );
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

/**
 * The developer's checkout as they share it: the demo repo with its own model
 * key in `.env`, the way a checkout that runs has one. Langy starts the app
 * itself on the llmops path and adds the LangWatch lines to the same file;
 * without the model key the first scenario run fails on the agent's side,
 * on credentials, before anything the path is about.
 */
export async function createGuidedCheckout({
  name,
}: {
  name: string;
}): Promise<DemoRepo> {
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
