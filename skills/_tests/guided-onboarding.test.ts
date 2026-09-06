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
  "the gateway base url": 'OPENAI_BASE_URL="https://gateway.langwatch.ai/v1"',
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

    it("checks for the production-app key before minting one", () => {
      const list = rendered.indexOf("langwatch virtual-keys list --format json");
      const create = rendered.indexOf(
        "langwatch virtual-keys create --name production-app",
      );
      expect(list).toBeGreaterThan(-1);
      expect(create).toBeGreaterThan(list);
    });

    it("uses no em dash", () => {
      expect(rendered).not.toContain("—");
    });
  });
});
