import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/langy/langy-code-access.feature: the code-changes skill is what
// tells Langy when a request needs the customer's code and when the platform
// alone can do the work. The decision table is that answer, so it is tested
// row by row rather than left to the model's reading.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function codeChangesSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "code-changes");
  expect(skill, "code-changes is a shipped native skill").toBeTruthy();
  return renderSkill(skill!);
}

function connectAgentSkill(): string {
  const skill = listNativeSkills(skillsRoot).find(
    (s) => s.slug === "connect-agent",
  );
  expect(skill, "connect-agent is a shipped native skill").toBeTruthy();
  return renderSkill(skill!);
}

/** The decision table rows, as "| request | yes-or-no | reason |". */
function decisionRows(rendered: string): { request: string; needsCode: string }[] {
  return rendered
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 3 && (cells[1] === "yes" || cells[1] === "no"))
    .map((cells) => ({ request: cells[0]!.toLowerCase(), needsCode: cells[1]! }));
}

function verdictFor(rows: { request: string; needsCode: string }[], phrase: string): string {
  const row = rows.find((candidate) => candidate.request.includes(phrase));
  expect(row, `the decision table names "${phrase}"`).toBeTruthy();
  return row!.needsCode;
}

describe("the code-changes skill", () => {
  describe("given its decision table is read", () => {
    /** @scenario "The skill names the work that needs code and the work that does not" */
    it("marks the work in the customer's program as needing code and the platform work as not", () => {
      const rendered = codeChangesSkill();
      const rows = decisionRows(rendered);
      expect(rows.length).toBeGreaterThan(3);

      expect(verdictFor(rows, "instrument tracing")).toBe("yes");
      expect(verdictFor(rows, "wire the sdk")).toBe("yes");
      expect(verdictFor(rows, "fix the agent behind a failing scenario")).toBe("yes");
      expect(verdictFor(rows, "run parameter on a connected agent")).toBe("yes");
      expect(verdictFor(rows, "version a hardcoded prompt")).toBe("yes");

      expect(verdictFor(rows, "create or edit a scenario")).toBe("no");
      expect(verdictFor(rows, "evaluator")).toBe("no");
      expect(verdictFor(rows, "prompt version")).toBe("no");
      expect(verdictFor(rows, "read traces")).toBe("no");

      expect(rendered).toContain("do the platform work and never ask for code access");
      expect(rendered).toContain("code_access");
    });
  });

  // The rules below come from a filmed dogfood where Langy probed for facts it
  // had been handed, reached for the sandbox shell while a folder was
  // connected, never asked a question the customer had explicitly offered,
  // claimed a registration it had read the opposite of, and titled a pull
  // request "Add comprehensive LangWatch tracing". Each is one sentence in the
  // skill, and a sentence with no test is a sentence that comes back out.
  describe("given a folder is connected", () => {
    /** @scenario "The workspace facts are the answer, not something to probe" */
    it("says the workspace facts are the answer rather than something to probe", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain("workspace facts from `code_access` ARE the answer");
      expect(rendered).toContain("ghAuthenticated");
      expect(rendered).toContain("Do not probe for any of them");
      expect(rendered).toContain("gh auth status");
    });

    /** @scenario "The sandbox tools are not for the customer's project" */
    it("keeps the sandbox shell off the customer's project and off invented flags", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain("The project lives only in the shared folder");
      expect(rendered).toContain("which holds none of the user's code");
      expect(rendered).toContain("a flag that does not exist");
      expect(rendered).toContain("takes no `--output`, `--json`, `--jq` or `--format`");
    });

    /** @scenario "A change to a connect call is restarted and read back" */
    it("restarts the server and reads the registration back before saying anything", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain("`local_bash` and `background: true`");
      expect(rendered).toContain("until the new parameter is in that list");
      expect(rendered).toContain("Never claim a registration the read does not show");
    });

    /** @scenario "The user's own offer of a choice is a question" */
    it("asks when the choice was offered or picks what gets tested, and decides otherwise", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain("The user offered you the choice");
      expect(rendered).toContain("The choice picks what gets tested");
      expect(rendered).toContain("Decide routine things yourself");
    });

    /** @scenario "The pull request title is the commit subject" */
    it("takes the pull request title from the commit subject and bans adjectives", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain(
        "The title is the commit subject with the type prefix removed",
      );
      expect(rendered).toContain("comprehensive");
    });

    /** @scenario "A checklist runs before the pull request is opened" */
    it("checks the body against the outputs and carries the address into the reply", () => {
      const rendered = codeChangesSkill();
      expect(rendered).toContain("The checklist before `gh pr create`");
      expect(rendered).toContain(
        "may only state what a command output **in this conversation** showed",
      );
      expect(rendered).toContain("langwatch agent get <name>");
      expect(rendered).toContain("the restart is left to the user");
      expect(rendered).toContain(
        "Copy that address into your reply, character for character",
      );
    });
  });
});

describe("the connect-agent skill", () => {
  describe("given the change goes into a pull request", () => {
    /** @scenario "The connected agent skill repeats the same checklist" */
    it("restarts and reads the parameters back before the pull request is opened", () => {
      const rendered = connectAgentSkill();
      expect(rendered).toContain("When the change goes into a pull request");
      expect(rendered).toContain("Restart the service that holds the connect call");
      expect(rendered).toContain("`langwatch agent get <name>`");
      expect(rendered).toContain("the restart is left to the user");
      expect(rendered).toContain(
        "is false unless the `agent get` output in this conversation lists both options",
      );
    });
  });
});
