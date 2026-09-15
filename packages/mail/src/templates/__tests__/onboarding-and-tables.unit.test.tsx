import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { DataTable } from "../email-layout.tsx";
import { inviteEmailTemplate } from "../invite-email.tsx";
import { joinRequestApprovedTemplate } from "../join-request-emails.tsx";
import { AGENT_PROMPT, FIRST_STEPS_LINKS, SKILLS_INSTALL_COMMAND } from "../onboarding/first-steps.tsx";
import { tokenize } from "../onboarding/highlight.ts";
import { renderMailTemplate, type MailTemplate } from "../registry.ts";
import { signUpVerificationEmailTemplate } from "../sign-up-verification-email.tsx";
import { triggerDigestEmailTemplate } from "../trigger-digest-email.tsx";

const html = async (template: MailTemplate, props: unknown): Promise<string> =>
  (await renderMailTemplate(template, props)).html;

/**
 * The rendered message with its markup taken off.
 *
 * A highlighted line is a run of `<span>`s, so a command a reader sees as one
 * string is several nodes in the HTML. What is asserted here is what the reader
 * reads, which means reading past the tags.
 */
const visibleText = (rendered: string): string =>
  rendered
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/**
 * The skill this mail tells a coding agent to follow, read from the skill.
 *
 * Pinned rather than copied: the prompt in the mail exists to make an agent
 * reach for a skill that actually exists, so if the skill is renamed or its own
 * prompt is rewritten, the mail that names it has to be wrong out loud rather
 * than quietly pointing at nothing.
 */
const tracingSkillPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../skills/tracing/SKILL.mdx",
);

describe("given the mail's syntax highlighter", () => {
  describe("when it reads a shell line", () => {
    /** @scenario "Code in a message is coloured without a runtime" */
    it("sets the command apart from its arguments", () => {
      const tokens = tokenize("npm install langwatch", "bash");

      expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual(
        ["npm", "langwatch"],
      );
    });
  });

  describe("when it reads a line with a string in it", () => {
    /** @scenario "A keyword inside a string is not coloured as a keyword" */
    it("colours the string whole and finds no keyword inside it", () => {
      const tokens = tokenize('const name = "import from go";', "typescript");

      expect(tokens.find((token) => token.kind === "string")?.text).toBe('"import from go"');
      expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual(
        ["const"],
      );
    });
  });

  describe("when it reads a call", () => {
    /** @scenario "A called identifier is coloured as a call" */
    it("marks the identifier before the bracket", () => {
      const tokens = tokenize("await setupObservability();", "typescript");

      expect(tokens.find((token) => token.kind === "call")?.text).toBe("setupObservability");
    });
  });
});

describe("given every message's shared shell", () => {
  describe("when the rendered head is read", () => {
    /** @scenario "Every message asks for the display face" */
    it("links the stylesheet that serves the display face", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, {
        email: "morgan@acme.example",
        verificationUrl: "https://app.langwatch.ai/v/1",
      });

      expect(rendered).toContain("https://api.fontshare.com/v2/css?f[]=sentient@400");
      expect(rendered).toContain("@font-face");
      expect(rendered).toContain("Sentient");
    });

    /** @scenario "A client that drops the face keeps the designed fallback" */
    it("names a real serif after the display face rather than the body sans", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, {
        email: "morgan@acme.example",
        verificationUrl: "https://app.langwatch.ai/v/1",
      });

      expect(rendered).toContain("ui-serif");
      expect(rendered).toContain("letter-spacing:-0.03em");
    });
  });
});

describe("given the shared data table", () => {
  const columns = [
    { key: "name", label: "Project" },
    { key: "count", label: "Traces", align: "right" as const },
    { key: "note", label: "Note" },
  ];
  const rows = [{ key: "a", cells: { name: "Support agent", count: "512,403", note: "" } }];

  describe("when it is rendered", () => {
    /** @scenario "A data table names its columns" */
    it("names each column it draws", async () => {
      const rendered = await render(<DataTable columns={columns} rows={rows} />);

      expect(rendered).toContain("Project");
      expect(rendered).toContain("Traces");
    });

    /** @scenario "A numeric column is aligned right" */
    it("aligns a numeric column right", async () => {
      const rendered = await render(<DataTable columns={columns} rows={rows} />);

      expect(rendered).toContain("text-align:right");
    });

    /** @scenario "A column no row fills is not drawn" */
    it("drops a column every row leaves empty", async () => {
      const rendered = await render(<DataTable columns={columns} rows={rows} />);

      expect(rendered).not.toContain("Note");
    });
  });

  describe("when it has no rows", () => {
    /** @scenario "A table with nothing in it draws nothing" */
    it("draws nothing", async () => {
      const rendered = await render(<DataTable columns={columns} rows={[]} />);

      expect(rendered).not.toContain("Project");
    });
  });
});

describe("given the first-steps block", () => {
  const signUpBase = {
    email: "morgan@acme.example",
    verificationUrl: "https://app.langwatch.ai/v/1",
  };

  describe("when nobody has said why they came", () => {
    /** @scenario "Unknown intent shows the software development kit steps" */
    it("shows the TypeScript lines and links Python and Go", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, {
        ...signUpBase,
        firstSteps: {},
      });

      expect(rendered).toContain("setupObservability");
      expect(rendered).toContain(FIRST_STEPS_LINKS.python);
      expect(rendered).toContain(FIRST_STEPS_LINKS.go);
    });

    /** @scenario "The first-steps block carries the skills command and the agent prompt" */
    it("carries the skills command and the agent prompt", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, {
        ...signUpBase,
        firstSteps: {},
      });

      expect(visibleText(rendered)).toContain(SKILLS_INSTALL_COMMAND);
      expect(visibleText(rendered)).toContain(AGENT_PROMPT);
      expect(rendered).toContain(FIRST_STEPS_LINKS.typescript);
    });
  });

  describe("when the organization came to watch its agents", () => {
    /** @scenario "An agent-governance organization is shown the command line, not an SDK" */
    it("shows the command line steps and no software development kit lines", async () => {
      const rendered = await html(joinRequestApprovedTemplate, {
        requesterEmail: "morgan@acme.example",
        organizationName: "Acme Corp",
        organizationUrl: "https://app.langwatch.ai/acme-corp",
        firstSteps: { intent: "AGENT_GOVERNANCE" },
      });

      expect(visibleText(rendered)).toContain("langwatch login");
      expect(rendered).toContain(FIRST_STEPS_LINKS.cli);
      expect(rendered).not.toContain("setupObservability");
    });
  });

  describe("when the organization came to trace an application", () => {
    /** @scenario "An operations organization is shown the software development kit steps" */
    it("shows the software development kit lines and no command line install", async () => {
      const rendered = await html(inviteEmailTemplate, {
        email: "morgan@acme.example",
        organization: { name: "Acme Corp" },
        acceptInviteUrl: "https://app.langwatch.ai/invite/inv_1",
        firstSteps: { intent: "LLM_OPS" },
      });

      expect(rendered).toContain("setupObservability");
      expect(visibleText(rendered)).not.toContain("langwatch login");
    });
  });

  describe("when the agent prompt is compared against the skill it names", () => {
    /** @scenario "The agent prompt is pinned to the tracing skill" */
    it("uses the tracing skill's own words for what it asks the agent to do", () => {
      const skill = readFileSync(tracingSkillPath, "utf8");
      const userPrompt = /user-prompt:\s*"([^"]+)"/.exec(skill)?.[1];

      expect({ found: userPrompt !== undefined, path: tracingSkillPath }).toEqual({
        found: true,
        path: tracingSkillPath,
      });
      expect(AGENT_PROMPT.toLowerCase()).toContain(
        (userPrompt ?? "").toLowerCase().replace(/^instrument my code/, "instrument my code"),
      );
    });
  });
});

describe("given the trigger digest", () => {
  const base = {
    triggerName: "Low satisfaction on checkout",
    triggerType: "alert",
    triggerMessage: "",
    projectSlug: "support-agent",
    baseHost: "https://app.langwatch.ai",
    triggerId: "auto_1",
  };

  describe("when its rows carry everything the sender had", () => {
    /** @scenario "A rich digest row shows when, what and the value" */
    it("draws a column for each of them", async () => {
      const rendered = await html(triggerDigestEmailTemplate, {
        ...base,
        entries: [
          {
            traceId: "trace_1",
            occurredAt: "09:14",
            preview: "My order still has not arrived",
            value: "0.21",
            unit: "satisfaction",
          },
        ],
      });

      expect(rendered).toContain("What matched");
      expect(rendered).toContain("When");
      expect(rendered).toContain("Value");
      expect(rendered).toContain("0.21 satisfaction");
      expect(rendered).toContain("09:14");
    });
  });

  describe("when its rows carry only identifiers", () => {
    /** @scenario "A sparse digest row is as informative as it ever was" */
    it("draws the identifier and none of the empty columns", async () => {
      const rendered = await html(triggerDigestEmailTemplate, {
        ...base,
        entries: [{ traceId: "trace_4KpQ2mXv9dLbR7" }],
      });

      expect(rendered).toContain("trace_4KpQ2mXv9dLbR7");
      expect(rendered).toContain(
        "https://app.langwatch.ai/support-agent/traces/trace_4KpQ2mXv9dLbR7",
      );
      expect(rendered).not.toContain("Value");
      expect(rendered).not.toContain("When");
    });
  });

  describe("when more matched than are listed", () => {
    /** @scenario "The digest counts what matched, what is listed and what is not" */
    it("shows the three counts over the table", async () => {
      const rendered = await html(triggerDigestEmailTemplate, {
        ...base,
        entries: Array.from({ length: 24 }, (_unused, index) => ({ traceId: `trace_${index}` })),
      });

      expect(rendered).toContain("Matched");
      expect(rendered).toContain("Listed here");
      expect(rendered).toContain("Not listed");
      expect(rendered).toContain(">14<");
    });
  });
});
