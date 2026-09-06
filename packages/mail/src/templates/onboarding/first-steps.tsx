import { z } from "zod";
import { HighlightedCode, InlineLink, Muted, Paragraph } from "../email-layout";

/**
 * The first thing to do, in the language of why they came.
 *
 * Two readers arrive through the same door and want opposite things from it.
 * Somebody who came to watch what their coding agents do wants the command line
 * and their agent running, not an SDK; somebody who came to trace an
 * application wants three lines in that application. Showing both is showing
 * neither, so the block asks what the organization said it came for.
 *
 * When nobody has said — and at sign-up nobody has, because the organization
 * does not exist until the address is confirmed — the block is the SDK one.
 * That is the safe default rather than the popular one: it is the step every
 * reader can take, and it is what the message said before the intent existed.
 */
export const onboardingIntentSchema = z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]);

export type OnboardingIntent = z.infer<typeof onboardingIntentSchema>;

export const firstStepsSchema = z.object({
  /**
   * Why the organization said it came, where an organization exists to say it.
   * Absent falls back to the software-development-kit steps.
   */
  intent: onboardingIntentSchema.optional(),
});

export type FirstSteps = z.infer<typeof firstStepsSchema>;

/**
 * The documentation addresses these steps point at.
 *
 * Constants rather than props, and the exception is narrow: a template never
 * builds a link to a DEPLOYMENT, because the deployment's own origin is the
 * deployment's. `docs.langwatch.ai` is the same address for every install, the
 * way the footer's documentation link already is.
 */
export const FIRST_STEPS_LINKS = {
  typescript: "https://docs.langwatch.ai/integration/typescript/guide",
  python: "https://docs.langwatch.ai/integration/python/guide",
  go: "https://docs.langwatch.ai/integration/go/guide",
  cli: "https://docs.langwatch.ai/integration/cli",
} as const;

/** The three lines, as each language's own documentation writes them. */
export const FIRST_STEPS_SNIPPETS = {
  typescript: `npm install langwatch
import { setupObservability } from "langwatch/observability/node";
await setupObservability();`,
  cli: `npm install -g langwatch
langwatch login
claude`,
} as const;

/** How the skills are installed, as the skills' own instructions give it. */
export const SKILLS_INSTALL_COMMAND = "npx skills add langwatch/skills";

/**
 * What to paste into a coding agent, in the words the tracing skill uses.
 *
 * "Instrument my code with LangWatch" is the skill's own user prompt, so the
 * agent that reads this reaches for the skill this sentence names rather than
 * improvising an integration. The key is named and never carried: a secret in
 * an email is a secret in an inbox.
 */
export const AGENT_PROMPT = `Install the LangWatch skills with ${SKILLS_INSTALL_COMMAND}, then instrument my code with LangWatch following the tracing skill. My API key is in LANGWATCH_API_KEY.`;

export const FirstSteps = ({ intent }: FirstSteps) => (
  <>
    <Paragraph style={{ margin: "0 0 4px", fontWeight: 600 }}>
      {intent === "AGENT_GOVERNANCE" ? "See your agents" : "Your first trace"}
    </Paragraph>
    {intent === "AGENT_GOVERNANCE" ? <AgentGovernanceSteps /> : <SoftwareKitSteps />}
    <Paragraph style={{ margin: "18px 0 4px", fontWeight: 600 }}>
      Or let your coding agent do it
    </Paragraph>
    <Muted>Add the LangWatch skills:</Muted>
    <HighlightedCode code={SKILLS_INSTALL_COMMAND} language="bash" />
    <Muted>Then paste this into your agent:</Muted>
    <HighlightedCode code={AGENT_PROMPT} language="bash" />
    <Muted>
      <InlineLink href={FIRST_STEPS_LINKS.typescript}>Open the quickstart</InlineLink> for every
      line here with a copy button.
    </Muted>
  </>
);

/**
 * The command line first, because this reader has no code to change.
 *
 * They came to see what their agents are doing, and the shortest path to that
 * is the agent they already run, in the project they already have.
 */
const AgentGovernanceSteps = () => (
  <>
    <Muted>Install the command line tool, sign in, and run your agent as you normally would.</Muted>
    <HighlightedCode code={FIRST_STEPS_SNIPPETS.cli} language="bash" />
    <Muted>
      <InlineLink href={FIRST_STEPS_LINKS.cli}>Read the command line guide</InlineLink> for signing
      in to a self-hosted instance, and for agents other than Claude Code.
    </Muted>
  </>
);

/**
 * TypeScript in the block, Python and Go as links.
 *
 * A mail cannot switch a tab, so a three-tab control in one is three snippets
 * stacked and two of them wrong for any given reader. One snippet and two links
 * is the same choice a tab strip offers, made in the medium that arrived.
 */
const SoftwareKitSteps = () => (
  <>
    <Muted>Tracing a TypeScript application takes three lines.</Muted>
    <HighlightedCode code={FIRST_STEPS_SNIPPETS.typescript} language="typescript" />
    <Muted>
      Working in something else? <InlineLink href={FIRST_STEPS_LINKS.python}>Python</InlineLink> and{" "}
      <InlineLink href={FIRST_STEPS_LINKS.go}>Go</InlineLink> have guides of their own.
    </Muted>
  </>
);
