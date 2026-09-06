import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  listNativeSkills,
  listPublishedSkills,
  renderSkill,
} from "../_compiler/native.js";

// Backs the skill rules of specs/langy/langy-guided-onboarding.feature: the
// skill ships with Langy only, and every line the product says is in it
// word for word, so the conversation the tour hands over to reads as designed.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

const VERBATIM_LINES = {
  "the llmops opener":
    "Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you.",
  "the first describe fallback line":
    "No problem. What does your agent do? One line is enough.",
  "the second describe fallback line":
    "Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?",
  "the proposal":
    "I read through the code. I think the first scenario we should write is {title}, because {reason}. Can I create and run it for you?",
  "the chat-about-this line":
    "Of course. Tell me what the scenario should cover and I'll write it with you.",
  "the why-a-scenario line":
    "Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.",
  "the running line": "Running it against your agent now.",
  "the two-things line":
    "That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.",
  "the closing line": "All ready! Let me know if there is anything I can help with.",
  "the coding opener":
    "You're a developer, so this one is easy. Run this in any repo where you use Claude Code:",
  "the coding command": "npx langwatch claude",
  "the coding closer":
    "Then I can show you around once your first traces are flying through.",
  "the gateway opener":
    "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:",
  "the gateway base url": 'OPENAI_BASE_URL="<the address after Gateway: in the brief>"',
  "the gateway closer":
    "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.",
  "the governance opener":
    "To govern anything I first need to see it. Your identity provider gives me people and teams, vendor billing exports give me the dollars, and each tool's admin API gives me seats and usage. Where should we start?",
  "the skipped tour line":
    "No worries! Everything the tour covers is in the menu on the left. I'll be right here when you need me.",
  "the mid-setup line":
    "We'll get to that! Let me finish getting you set up first, then I'm all yours.",
} as const;

describe("the guided-onboarding skill", () => {
  describe("given the native and published skill sets", () => {
    /** @scenario "The skill is native-only and compiled" */
    it("ships with Langy and never on the public directory", () => {
      const native = listNativeSkills(skillsRoot).map((s) => s.slug);
      const published = listPublishedSkills(skillsRoot).map((s) => s.slug);
      expect(native).toContain("guided-onboarding");
      expect(published).not.toContain("guided-onboarding");
    });

    it("is compiled into the native tree Langy loads", () => {
      const compiled = path.join(
        skillsRoot,
        "_compiled/native/guided-onboarding/SKILL.md",
      );
      expect(fs.existsSync(compiled), compiled).toBe(true);
      const rendered = renderSkill(
        listNativeSkills(skillsRoot).find((s) => s.slug === "guided-onboarding")!,
      );
      expect(fs.readFileSync(compiled, "utf8")).toBe(rendered);
    });
  });

  describe("when the compiled skill is read", () => {
    const rendered = renderSkill(
      listNativeSkills(skillsRoot).find((s) => s.slug === "guided-onboarding")!,
    );

    /** @scenario "The skill carries every opener and closer verbatim" */
    it.each(Object.entries(VERBATIM_LINES))("contains %s", (_, line) => {
      expect(rendered).toContain(line);
    });

    it("offers the describe way out on the first code access call only", () => {
      expect(rendered).toContain("`code_access` with `offer_describe: true`");
      expect(rendered).toContain("without `offer_describe`");
    });

    /** @scenario "The opener is followed by the card and nothing else" */
    it("puts nothing between the opener and the code access card", () => {
      expect(rendered).toContain(
        "Nothing goes between the opener and the card: when the tool waits for the user, the turn is over, so say nothing more.",
      );
    });

    it("marks the chat option quiet and asks before creating anything", () => {
      expect(rendered).toContain('"Chat about this", quiet');
      expect(rendered).toContain("Do not create it yet.");
    });

    it("ends every path by recording its completion", () => {
      for (const p of ["llmops", "coding", "gateway", "governance"]) {
        expect(rendered).toContain(`langwatch onboarding complete-path ${p}`);
      }
    });

    /** @scenario "The gateway snippet points at the instance's own gateway" */
    it("takes the gateway address from the brief and never from a remembered host", () => {
      expect(rendered).not.toContain("gateway.langwatch.ai");
      expect(rendered).toContain("The gateway address is the value after `Gateway:` in the brief, exactly as it stands there");
    });

    /** @scenario "A key the tour minted gets the live line, not an apology" */
    it("opens on the live line when the tour already minted the key", () => {
      expect(rendered).toContain("say nothing about that, open with the line below as if the key were just made");
      expect(rendered).toContain("<the production-app key the dialog showed>");
      expect(rendered).not.toContain("<your production-app key>");
    });

    it("checks for the production-app key before minting one", () => {
      const list = rendered.indexOf("langwatch virtual-keys list --format json");
      const create = rendered.indexOf(
        "langwatch virtual-keys create --name production-app",
      );
      expect(list).toBeGreaterThan(-1);
      expect(create).toBeGreaterThan(list);
    });

    /** @scenario "The brief is the whole input" */
    it("never reads the onboarding state during a guided path", () => {
      expect(rendered).toContain(
        "Never run `langwatch onboarding state` during a guided path",
      );
      expect(rendered).not.toContain("run it only when a line you need is missing");
    });

    /** @scenario "The work happens on a Langy branch" */
    it("works on a langy branch, never on the user's checked-out branch", () => {
      expect(rendered).toContain(
        "never on the branch the user has checked out",
      );
      expect(rendered).toContain("`git checkout -b langy/<slug> origin/<default>`");
      expect(rendered).toContain("Leave the branch checked out");
    });

    it("names the docs page by language and framework", () => {
      expect(rendered).toContain(
        "`langwatch docs integration/<python|typescript>/integrations/<framework>`",
      );
      expect(rendered).not.toContain("integration/<framework>`)");
    });

    /** @scenario "The credentials are written after the tracing edit" */
    it("has the command line write the credentials after the tracing edit", () => {
      const tracing = rendered.indexOf("`tracing` for the detected framework");
      const credentials = rendered.indexOf("call `local_langwatch_env` once");
      const start = rendered.indexOf("Start the agent from that branch");
      expect(tracing).toBeGreaterThan(-1);
      expect(credentials).toBeGreaterThan(tracing);
      expect(start).toBeGreaterThan(credentials);
      expect(rendered).toContain("The key never reaches you");
    });

    /** @scenario "Nothing runs against an agent that is not online" */
    it("waits for the agent row to be online through one CLI call, before any run", () => {
      expect(rendered).toContain(
        "run `langwatch agent list --wait-online <agent name> --format json` once",
      );
      expect(rendered).toContain(
        "it fails after two minutes when the row never does. Never write a loop of your own around `agent list`.",
      );
      expect(rendered).toContain(
        "Nothing runs against an agent that is not online: no scenario, no suite.",
      );
    });

    /** @scenario "The path ends in a fixed order" */
    it("states the end of the path as one fixed order", () => {
      expect(rendered).toContain(
        "create the scenario, open it, the why-a-scenario line, run it, the two-things line, the suite with its scenarios, the suite run, open the run, the commit and the pull request, the closing line, and `complete-path` last",
      );
      const order = [
        'langwatch scenario create "<title>"',
        "langwatch navigate open <scenario_id>",
        VERBATIM_LINES["the why-a-scenario line"],
        "langwatch scenario run <scenario_id>",
        VERBATIM_LINES["the two-things line"],
        'langwatch test-suite create "Full regression"',
        "langwatch test-suite run <suite_id>",
        "langwatch navigate open <the scenariorun_ id the suite run printed>",
        "commit and open the pull request",
        VERBATIM_LINES["the closing line"],
        "langwatch onboarding complete-path llmops",
      ];
      const positions = order.map((line) => rendered.indexOf(line));
      for (const [index, position] of positions.entries()) {
        expect(position, order[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]!);
      }
    });

    /** @scenario "A failed first run still gets the two-things line" */
    it("says the two-things line after a failed verdict, and only an error skips it", () => {
      expect(rendered).toContain(
        "A run that answers a verdict, passed or failed, gets the two-things line.",
      );
      expect(rendered).toContain(
        "**If the run failed**, the explanation comes first: say in plain words what the judge saw and why the agent did not meet the criteria, and point at the run so they can replay the conversation.",
      );
      expect(rendered).toContain(
        "the run still proved what the line says: the agent answered, and the traces flowed.",
      );
      expect(rendered).not.toContain("**If the run passed**");
      const explanation = rendered.indexOf("**If the run failed**");
      const line = rendered.indexOf(VERBATIM_LINES["the two-things line"]);
      expect(explanation).toBeGreaterThan(-1);
      expect(line).toBeGreaterThan(explanation);
    });

    /** @scenario "A failed step stops with one line and no completion" */
    it("stops on a failed step with one line and no completion", () => {
      const failed = rendered.indexOf("### When a step fails");
      expect(failed).toBeGreaterThan(-1);
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain(
        "say in one line what is not done and what the error names as the cause, and end the turn",
      );
      expect(section).toContain("stop there, without diagnosing");
      expect(section).toContain("`langwatch onboarding complete-path` does not run");
      expect(section).toContain(
        "the why-a-scenario line, the two-things line and the closing line are not said",
      );
      expect(section).toContain("a scenario or suite run answers an error instead of a verdict");
      expect(rendered).toContain(
        "never one that stopped at a failed step",
      );
    });

    /** @scenario "The instrumentation that cannot be applied stops the path" */
    it("names the refused key and the failed tracing edit among the stops", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain("The credentials call answers that the key was refused");
      expect(section).toContain("the tracing edit cannot be applied");
      expect(section).toContain("from the project's settings page");
    });

    it("uses no em dash", () => {
      expect(rendered).not.toContain("—");
    });
  });
});
