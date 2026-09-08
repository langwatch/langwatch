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
    "Now that your agent is integrated, I think we should write some tests for it: scenario tests prove your agent handles the conversations it exists for, and each run is traced so you see every step. The first one I'd write is {title}, because {reason}.",
  "the pull request line":
    "I opened a pull request with the tracing change: {link}. You can merge it already.",
  "the no-remote line":
    "No pull request was opened, since the folder has no remote or gh is not signed in: branch {branch} holds the commit.",
  "the branch line":
    "I left branch {branch} checked out: the agent you started runs on it.",
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
  "the gateway base url":
    "OPENAI_BASE_URL=the address after Gateway: in the brief, in double quotes",
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
      expect(rendered).toContain(
        "The line is said first and the card follows it, never the other way round.",
      );
      const opener = rendered.indexOf(VERBATIM_LINES["the llmops opener"]);
      const card = rendered.indexOf("call `code_access` with `offer_describe: true`");
      expect(opener).toBeGreaterThan(-1);
      expect(card).toBeGreaterThan(opener);
    });

    it("marks the chat option quiet and asks before creating anything", () => {
      expect(rendered).toContain('"Chat about this", quiet');
      expect(rendered).toContain("Do not create it yet.");
    });

    /** @scenario "Sharing the folder leads to a proposal, not a creation" */
    it("puts the proposal in the question field of a bare question whose first option names the scenario", () => {
      const bare = rendered.indexOf("ask with the `question` tool with `bare: true`");
      const proposal = rendered.indexOf(VERBATIM_LINES["the proposal"]);
      const create = rendered.indexOf('1. Create "{title}" as your first scenario test');
      const chat = rendered.indexOf('2. "Chat about this", quiet');
      expect(bare).toBeGreaterThan(-1);
      expect(proposal).toBeGreaterThan(bare);
      expect(create).toBeGreaterThan(proposal);
      expect(chat).toBeGreaterThan(create);
      expect(rendered).toContain(
        "so the proposal is the `question` field itself, verbatim",
      );
      expect(rendered).toContain(
        "With the three step 2 lines said, ask with the `question` tool with `bare: true`, in that same turn, with no reply text before the call",
      );
      expect(rendered).not.toContain("Say the proposal as your reply");
      expect(rendered).not.toContain("it is recorded with the answer and not drawn");
      expect(rendered).not.toContain("Sure, go ahead!");
    });

    /** @scenario "The step 2 lines are said before the card, and the answer is the go" */
    it("says the step 2 lines with the say tool right before the question call and goes straight to the checklist after the answer", () => {
      const lines = rendered.indexOf(
        "These three lines of step 2, the framework line, the pull request line or the no-remote line, and the branch line, are said with the `say` tool, one call each, in that order, in this same step, right after the pull request command answered and right before the question of step 3: never after the answer, and never in the reply text.",
      );
      const ask = rendered.indexOf("With the three step 2 lines said, ask with the `question` tool");
      const go = rendered.indexOf(
        'The answer to the question is the go. On the create option, or on the scenario agreed after "Chat about this", the next thing you do is this list, then the first command: no sentence between the answer and them, and nothing from step 2 said again; a reply that only speaks after the answer ends the turn with the path open. So, before any command, write this list into `todowrite`',
      );
      // Step 4's own list: step 2 has one of its own, earlier in the skill.
      const list = rendered.indexOf("write this list into `todowrite`", go);
      expect(lines).toBeGreaterThan(-1);
      expect(ask).toBeGreaterThan(lines);
      expect(go).toBeGreaterThan(ask);
      expect(list).toBeGreaterThan(go);
      expect(rendered).not.toContain("say nothing before the call beyond the step 2 lines");
      expect(rendered).not.toContain("are written before the question of step 3 is called");
    });

    /** @scenario "Code access is asked once, and the framework line names a file that was read" */
    it("never asks code access again while a folder is connected, and sources the framework line from a file it read", () => {
      expect(rendered).toContain(
        "**While a folder is connected, `code_access` is never called again.** The card is for the not-connected case only: the connect brought the folder facts, and the files are read with the `local_*` tools.",
      );
      expect(rendered).toContain(
        "A folder that looks empty is read with `local_ls`, never with the sandbox's own shell, which holds no project of the user's.",
      );
      expect(rendered).toContain(
        "The file it names is one you read with `local_read` in this step, and the framework is what that file imports: a docs page is never a source for the line, and a framework no file of theirs shows was not found.",
      );
    });

    /** @scenario "The scenarios name outcomes and carry the inputs they hinge on" */
    it("names observable outcomes in the criteria and puts the concrete input in every suite situation", () => {
      expect(rendered).toContain(
        'Its criteria name what the person can see in the conversation, never the tool that produces it: "returns an order number", not "calls place_order".',
      );
      expect(rendered).toContain(
        "Every scenario of the suite carries, in its situation, the concrete input it hinges on, read from the code: the discount code, the card number the code declines, the id.",
      );
      expect(rendered).toContain(
        "Read the file that holds the rule before writing the situation. The criteria name outcomes, as for the first scenario, never tools.",
      );
      // The rule sits with the suite commands, after them and before item 9.
      const suite = rendered.indexOf('langwatch test-suite create "Full regression"');
      const inputs = rendered.indexOf("Every scenario of the suite carries, in its situation");
      const item9 = rendered.indexOf("Item 9: the commit and the pull request exist since step 2");
      expect(inputs).toBeGreaterThan(suite);
      expect(item9).toBeGreaterThan(inputs);
    });

    /** @scenario "Every scripted line is said with the say tool at its moment" */
    it("says every scripted line with the say tool, and leaves the proposal in the question field", () => {
      expect(rendered).toContain(
        "**Every line below is verbatim, and said with the `say` tool.**",
      );
      expect(rendered).toContain(
        "a turn whose lines were all said this way ends with no reply text at all",
      );
      expect(rendered).toContain(
        "The proposal is the one exception: it is the `question` field of its bare question.",
      );
      // Every verbatim line is introduced by a say instruction, at its moment.
      for (const key of [
        "the llmops opener",
        "the first describe fallback line",
        "the second describe fallback line",
        "the chat-about-this line",
        "the two-things line",
        "the closing line",
        "the coding opener",
        "the coding closer",
        "the gateway opener",
        "the gateway closer",
        "the skipped tour line",
      ] as const) {
        const at = rendered.indexOf(VERBATIM_LINES[key]);
        expect(at, key).toBeGreaterThan(-1);
        const before = rendered.slice(Math.max(0, at - 900), at);
        expect(before, key).toContain("`say`");
      }
      expect(rendered).toContain(
        "Item 3 is one step: the two lines below, each said with `say`, verbatim, then the run in the same step.",
      );
      expect(rendered).toContain("Needs the code_access, question, say and secret_snippet tools");
      expect(rendered).not.toContain("Say, verbatim:");
      expect(rendered).not.toContain("Then say, verbatim");
    });

    it("ends every path by recording its completion", () => {
      for (const p of ["llmops", "coding", "gateway", "governance"]) {
        expect(rendered).toContain(`langwatch onboarding complete-path ${p}`);
      }
    });

    /** @scenario "Every path ends by recording its completion" */
    it("runs complete-path before the closing line on every path, so the line is what follows the call", () => {
      expect(rendered).toContain(
        "It runs right before the closing line, in the same step, with no other tool call beside it, and never before the path's work is done.",
      );
      expect(rendered).toContain(
        "When it returns, say the closing line with `say`, verbatim, as the last thing the turn does, and the turn is over: no reply text after it, and never the line twice.",
      );
      const endings: Array<[string, string]> = [
        ["langwatch onboarding complete-path llmops", VERBATIM_LINES["the closing line"]],
        ["langwatch onboarding complete-path coding", VERBATIM_LINES["the coding closer"]],
        ["langwatch onboarding complete-path governance", "Then say in one line, with `say`, which source to add first on that page, as the last thing the turn does, and stop."],
      ];
      for (const [command, line] of endings) {
        const call = rendered.lastIndexOf(command);
        const said = rendered.lastIndexOf(line);
        expect(call, command).toBeGreaterThan(-1);
        expect(said, line).toBeGreaterThan(call);
      }
      // The coding copy keeps its command block right after the opener, and
      // the closer moves behind the call.
      const codingOpener = rendered.indexOf(VERBATIM_LINES["the coding opener"]);
      const codingCommand = rendered.indexOf(VERBATIM_LINES["the coding command"]);
      const codingClose = rendered.indexOf("langwatch onboarding complete-path coding");
      const codingCloser = rendered.indexOf(VERBATIM_LINES["the coding closer"]);
      expect(codingCommand).toBeGreaterThan(codingOpener);
      expect(codingClose).toBeGreaterThan(codingCommand);
      expect(codingCloser).toBeGreaterThan(codingClose);
    });

    /** @scenario "The gateway snippet points at the instance's own gateway" */
    it("takes the gateway address from the brief and never from a remembered host", () => {
      expect(rendered).not.toContain("gateway.langwatch.ai");
      expect(rendered).toContain("The gateway address is the value after `Gateway:` in the brief, exactly as it stands there");
    });

    /** @scenario "A key the tour minted gets the live line, not an apology" */
    it("opens on the live line when the tour already minted the key, with the reveal id from the brief", () => {
      expect(rendered).toContain("Say nothing about the key having existed; open with the line below as if it were just made.");
      expect(rendered).toContain(
        "the `Virtual key:` line of the brief carries its name, its preview and its reveal id, and that is where they come from",
      );
      expect(rendered).not.toContain("the dialog showed");
    });

    /** @scenario "The gateway snippet is shown through the secret snippet card, never printed" */
    it("mints with --reveal-once and shows the snippet through the secret_snippet card", () => {
      expect(rendered).toContain(
        "langwatch virtual-keys create --name production-app --reveal-once --format json",
      );
      expect(rendered).toContain("The output carries `reveal_id` and `preview`, never the secret.");
      expect(rendered).toContain(
        "call `secret_snippet` with the reveal id, the preview, and this template",
      );
      expect(rendered).toContain('export OPENAI_API_KEY="{{secret}}"');
      expect(rendered).not.toContain('export OPENAI_API_KEY="<the key>"');
      expect(rendered).toContain(
        "never write a value that starts with `vk-lw-` in a message, and never write the snippet yourself",
      );
      const line = rendered.indexOf("Your key production-app is live.");
      const card = rendered.indexOf("call `secret_snippet`");
      expect(line).toBeGreaterThan(-1);
      expect(card).toBeGreaterThan(line);
    });

    /** @scenario "The reveal id in the brief is used before any list, question or mint" */
    it("tries the reveal id in hand first, and only lists or asks when the brief carries none", () => {
      expect(rendered).toContain("Three cases, checked in this order. The first that matches is the whole path; the ones after it never run.");
      const inHand = rendered.indexOf("1. **The brief carries a reveal id.**");
      const noIdKeyExists = rendered.indexOf("2. **No reveal id in the brief, and the key exists.**");
      const noIdNoKey = rendered.indexOf("3. **No reveal id in the brief, and no key.**");
      const list = rendered.indexOf("langwatch virtual-keys list --format json");
      const create = rendered.indexOf("langwatch virtual-keys create --name production-app --reveal-once --format json");
      const question = rendered.indexOf("Do you still have it?");
      expect(inHand).toBeGreaterThan(-1);
      expect(noIdKeyExists).toBeGreaterThan(inHand);
      expect(noIdNoKey).toBeGreaterThan(noIdKeyExists);
      expect(list).toBeGreaterThan(inHand);
      expect(list).toBeLessThan(noIdNoKey);
      expect(create).toBeGreaterThan(noIdNoKey);
      expect(question).toBeGreaterThan(create);
      expect(rendered).toContain("No list, no question, no minting: go straight to \"Show the key\" with the brief's reveal id and preview.");
      expect(rendered).toContain("Never mint a second key while the brief carries a reveal id");
      expect(rendered).toContain("### No reveal id in hand: ask first");
      expect(rendered).toContain("Reached only from case 2: the brief carries no reveal id and a `production-app` row exists.");
      expect(rendered).not.toContain("When the key exists but the brief carries no reveal id");
    });

    /** @scenario "Every gateway ending says the closing line after the card, inline" */
    it("ends each gateway ending on complete-path then the closing line, written inline after the card", () => {
      const section = rendered.slice(
        rendered.indexOf("## gateway: Gateway"),
        rendered.indexOf("## governance: Governance"),
      );
      const closer = VERBATIM_LINES["the gateway closer"];
      const closeCommand = "langwatch onboarding complete-path gateway";
      expect(section).not.toContain("Close the path");
      expect(section.split(closer).length - 1).toBe(2);
      expect(section.split(closeCommand).length - 1).toBe(2);

      const showTheKey = section.slice(
        section.indexOf("### Show the key"),
        section.indexOf("### No reveal id in hand: ask first"),
      );
      const card = showTheKey.indexOf("call `secret_snippet`");
      const showCloser = showTheKey.indexOf(closer);
      const showClose = showTheKey.indexOf(closeCommand);
      expect(card).toBeGreaterThan(-1);
      expect(showClose).toBeGreaterThan(card);
      expect(showCloser).toBeGreaterThan(showClose);

      const askFirst = section.slice(section.indexOf("### No reveal id in hand: ask first"));
      const askCard = askFirst.indexOf("show the snippet through the `secret_snippet` card");
      const saved = askFirst.indexOf('On "I saved it"');
      const askClose = askFirst.indexOf(closeCommand);
      const askCloser = askFirst.indexOf(closer);
      expect(askCard).toBeGreaterThan(-1);
      expect(askClose).toBeGreaterThan(askCard);
      expect(askClose).toBeGreaterThan(saved);
      expect(askCloser).toBeGreaterThan(askClose);
    });

    /** @scenario "A key that exists with no reveal gets a question, never a placeholder" */
    it("asks when the brief carries no reveal id and the key exists, and never writes a placeholder", () => {
      expect(rendered).toContain(
        "Your production-app key was created earlier and its secret was shown once, at creation. Do you still have it?",
      );
      expect(rendered).toContain('1. "Create a new key"');
      expect(rendered).toContain('2. "I saved it"');
      expect(rendered).toContain(
        "On \"Create a new key\": mint one with `--reveal-once` as above",
      );
      expect(rendered).toContain(
        "On \"I saved it\": there is no card to show, so describe the two lines instead of writing a snippet.",
      );
      expect(rendered).toContain(
        "Never write a placeholder in a snippet: no angle brackets",
      );
      expect(rendered).not.toContain("<your production-app key>");
      expect(rendered).not.toContain("<your gateway URL>");
      expect(rendered).not.toMatch(/OPENAI_API_KEY="<[^>]*>"/);
      expect(rendered).not.toMatch(/OPENAI_BASE_URL="<[^>]*>"/);
    });

    /** @scenario "The skill's case one repeats the brief's Virtual key instruction word for word" */
    it("reads the brief's instruction in case one and never runs the list while a reveal id is in hand", () => {
      const section = rendered.slice(
        rendered.indexOf("## gateway: Gateway"),
        rendered.indexOf("## governance: Governance"),
      );
      const caseOne = section.slice(
        section.indexOf("1. **The brief carries a reveal id.**"),
        section.indexOf("2. **No reveal id in the brief, and the key exists.**"),
      );
      expect(caseOne).toContain(
        'The line reads "Virtual key: production-app is live (preview ..., reveal id ...). Show it with secret_snippet using this reveal id. Do not list, ask or create keys." Do exactly that.',
      );
      expect(caseOne).toContain(
        "`langwatch virtual-keys list` is never run while the brief names a reveal id",
      );
      expect(caseOne).not.toContain("langwatch virtual-keys list --format json");
      expect(section).toContain(
        "Only now, with the brief saying none was minted, run `langwatch virtual-keys list --format json`.",
      );
      expect(rendered).toContain(
        "When it names a reveal id, the line itself says what to do, and that is the whole gateway path: show the key with `secret_snippet` using this reveal id, and do not list, ask or create keys.",
      );
      expect(rendered).not.toMatch(/check first|checked first|may already have minted|list first/i);
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

    /** @scenario "The instrumentation is committed once the agent is online" */
    it("commits the instrumentation on the langy branch as soon as the agent is online, with one fixed message", () => {
      const online = rendered.indexOf("run `langwatch agent list --wait-online <agent name> --format json` once");
      const commit = rendered.indexOf(
        'git add <the files you changed> && git commit -m "Add LangWatch tracing and the connect endpoint"',
      );
      const proposal = rendered.indexOf("### 3. Propose the first scenario, and stop");
      expect(online).toBeGreaterThan(-1);
      expect(commit).toBeGreaterThan(online);
      expect(proposal).toBeGreaterThan(commit);
      expect(rendered).toContain("never the env file and never `git add -A`");
      expect(rendered).toContain("with this message and no trailer");
      expect(rendered).toContain(
        "keep that branch checked out: the agent you started runs on it, and the branch line says so, verbatim, with the same brace:",
      );
    });

    /** @scenario "The pull request is opened before the proposal" */
    it("pushes and opens the pull request right after the tracing commit, says the address in one sentence, then proposes", () => {
      const commit = rendered.indexOf(
        'git add <the files you changed> && git commit -m "Add LangWatch tracing and the connect endpoint"',
      );
      const push = rendered.indexOf(
        "8. Push the branch and open the pull request, as steps 5 and 6 of `code-changes` say, with the title `Add LangWatch tracing and the connect endpoint`.",
      );
      const sentence = rendered.indexOf(VERBATIM_LINES["the pull request line"]);
      const noRemote = rendered.indexOf(
        "No remote, or no `gh` login: no pull request was opened, so this line takes the pull request line's place, verbatim, with the brace filled with the branch name, and the step is done:",
      );
      const proposal = rendered.indexOf("### 3. Propose the first scenario, and stop");
      expect(commit).toBeGreaterThan(-1);
      expect(push).toBeGreaterThan(commit);
      expect(sentence).toBeGreaterThan(push);
      expect(noRemote).toBeGreaterThan(sentence);
      expect(proposal).toBeGreaterThan(noRemote);
      expect(rendered).toContain("The proposal of step 3 comes right after them, in the same turn.");
    });

    /** @scenario "Step 2 is a checklist Langy keeps" */
    it("writes step 2 into the plan tool as a fixed checklist before the first edit, and asks the proposal only when every item is done", () => {
      const items = [
        "1. Read the code and name the framework",
        "2. The langy branch checked out",
        "3. The langwatch package added through the project's own package manager",
        "4. The tracing edit",
        "5. The connect adapter",
        "6. Credentials written and checked",
        "7. The agent started in the background",
        "8. The agent online, through agent list --wait-online",
        "9. The commit",
        "10. The push and the pull request, or the no-remote line",
        "11. The three step 2 lines said",
      ];
      const positions = items.map((item) => rendered.indexOf(item));
      for (const [index, position] of positions.entries()) {
        expect(position, items[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]!);
      }
      const list = rendered.indexOf(
        "Before the branch and the first edit, write this list into `todowrite`, in this order and these words, every item pending",
      );
      const branch = rendered.indexOf("`git checkout -b langy/<slug> origin/<default>`");
      expect(list).toBeGreaterThan(-1);
      expect(positions[0]).toBeGreaterThan(list);
      expect(branch).toBeGreaterThan(positions[10]!);
      expect(rendered).toContain(
        "The bare question of step 3 is asked only when every item of this list is done, never with one open: an item skipped is a step skipped, whatever the lines say.",
      );
    });

    /** @scenario "The step 2 lines name only what the commands made" */
    it("fills the step 2 lines from what the commands printed, and never from a fallback", () => {
      expect(rendered).toContain(
        "Then run `git branch --show-current`: its output is the name the lines below carry.",
      );
      expect(rendered).toContain(
        "with the brace filled with the address `gh pr create` printed, and said only when it printed one:",
      );
      expect(rendered).toContain(
        "never fill a brace with a fallback sentence, and never name a branch, a commit or a pull request that a command did not make; a line about a thing that did not happen is a false claim about the user's repository",
      );
      expect(rendered).toContain(
        "in this same step, right after the pull request command answered and right before the question of step 3",
      );
      const pullRequest = rendered.indexOf(VERBATIM_LINES["the pull request line"]);
      const noRemote = rendered.indexOf(VERBATIM_LINES["the no-remote line"]);
      const branchLine = rendered.indexOf(VERBATIM_LINES["the branch line"]);
      expect(pullRequest).toBeGreaterThan(-1);
      expect(noRemote).toBeGreaterThan(pullRequest);
      expect(branchLine).toBeGreaterThan(noRemote);
      // One brace each, and only the one the commands fill.
      expect(VERBATIM_LINES["the no-remote line"].match(/\{[a-z]+\}/g)).toEqual(["{branch}"]);
      expect(VERBATIM_LINES["the branch line"].match(/\{[a-z]+\}/g)).toEqual(["{branch}"]);
    });

    /** @scenario "The langwatch package is installed before the tracing edit" */
    it("installs the package through the project's own package manager, as a checklist item between the branch and the tracing edit", () => {
      const branch = rendered.indexOf("2. The langy branch checked out");
      const install = rendered.indexOf("3. The langwatch package added through the project's own package manager");
      const tracingItem = rendered.indexOf("4. The tracing edit");
      expect(install).toBeGreaterThan(branch);
      expect(tracingItem).toBeGreaterThan(install);
      const how = rendered.indexOf(
        "1. Install the package, as step 2 of the `tracing` skill says for the language, from the project root, through the project's own package manager: `uv add langwatch` when the project has a `uv.lock`, `pip install langwatch` otherwise; `npm install langwatch` or `pnpm add langwatch` by the lockfile present.",
      );
      const tracingStep = rendered.indexOf("2. `tracing` for the detected framework.");
      expect(how).toBeGreaterThan(-1);
      expect(tracingStep).toBeGreaterThan(how);
      expect(rendered).toContain(
        "The item is done when the manifest (`pyproject.toml` or `package.json`) names the package.",
      );
      expect(rendered).toContain(
        "the manifest and the lockfile the install of item 1 changed, the tracing edit, the connect adapter",
      );
    });

    /** @scenario "The wait for the agent gets more room than it takes" */
    it("runs the wait with a shell timeout above the wait itself, so the CLI's own line is what it reads", () => {
      expect(rendered).toContain(
        "run `langwatch agent list --wait-online <agent name> --format json` once, with the `timeout` parameter of the shell tool set to 150:",
      );
      expect(rendered).toContain(
        "The wait takes up to 120 seconds, so a shell limit at or under that cuts the command before the CLI prints its line",
      );
      expect(rendered).toContain("the wait always gets more room than it takes");
    });

    /** @scenario "A wait that fails gets one repair round" */
    it("repairs its own step once when the agent never comes online, and stops on the second failed wait", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain(
        "When its last lines name a cause in your own work of this step, a module that is not installed, an import or syntax error in a file you edited, a name the adapter got wrong, fix that cause, start the agent again the same way and run the wait once more, with the same timeout.",
      );
      expect(section).toContain(
        "The repair happens once and never touches the env file or reads the key: a second failed wait, or a cause outside those edits, stops there as this section says",
      );
    });

    /** @scenario "The closing line waits for the suite run" */
    it("says the closing line only once the suite ran and its run is open", () => {
      expect(rendered).toContain(
        "Item 10, only once item 8 is done, so the suite ran and its run is open, and never before. Close the path first:",
      );
      const suiteRun = rendered.indexOf("langwatch test-suite run <suite_id>");
      const closing = rendered.indexOf(VERBATIM_LINES["the closing line"]);
      expect(closing).toBeGreaterThan(suiteRun);
      expect(rendered).toContain(
        "Item 9: the commit and the pull request exist since step 2, so commit and push again only when a file changed since; the change lands on the same pull request",
      );
    });

    /** @scenario "The first scenario is the golden path" */
    it("proposes the agent's golden path first and keeps failure cases for the suite", () => {
      expect(rendered).toContain(
        "The first scenario is the agent's golden path: the thing the agent exists to do, end to end, with inputs the code accepts",
      );
      expect(rendered).toContain(
        "Refusals, expired inputs and edge cases come in the suite after it, never first",
      );
    });

    /** @scenario "The running line and the run are one step" */
    it("never ends the turn on the running line", () => {
      const line = rendered.indexOf(VERBATIM_LINES["the running line"]);
      const run = rendered.indexOf("langwatch scenario run <scenario_id>");
      expect(line).toBeGreaterThan(-1);
      expect(run).toBeGreaterThan(line);
      expect(rendered).toContain(
        "Never end the turn on the running line: a turn that ends there ran nothing.",
      );
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
      const credentials = rendered.indexOf("Call `local_langwatch_env` once");
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
        "it fails after two minutes when the row never does.",
      );
      expect(rendered).toContain(
        "the wait always gets more room than it takes. Never write a loop of your own around `agent list`.",
      );
      expect(rendered).toContain(
        "Nothing runs against an agent that is not online: no scenario, no suite.",
      );
    });

    /** @scenario "The path is a checklist Langy keeps" */
    it("writes the end of the path into the plan tool as a fixed checklist and never ends a turn with an open item", () => {
      const items = [
        "1. Create the first scenario",
        "2. Open it beside the panel",
        "3. Why a scenario, and run it",
        "4. The two-things line",
        "5. The remaining scenarios",
        "6. The suite",
        "7. Run the suite",
        "8. Open the suite run",
        "9. Commit and push, when a file changed since the pull request",
        "10. Complete-path, then the closing line",
      ];
      const positions = items.map((item) => rendered.indexOf(item));
      for (const [index, position] of positions.entries()) {
        expect(position, items[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]!);
      }
      expect(rendered).toContain("before any command, write this list into `todowrite`, in this order and these words, every item pending");
      expect(rendered).toContain("**a turn never ends with an open item**, unless a command answered an error");
      expect(rendered).toContain("Mark each item done as you finish it, and read the list before you end a turn");
    });

    /** @scenario "A folder with no remote still completes the path" */
    it("treats a missing remote or gh login as the pull request item done, not as a failed step", () => {
      expect(rendered).toContain(
        "A missing remote, a missing `gh` login and a failed verdict are not errors: the step is done with its line, and the next one starts.",
      );
      expect(rendered).toContain(
        "No remote, or no `gh` login: no pull request was opened, so this line takes the pull request line's place, verbatim, with the brace filled with the branch name, and the step is done:",
      );
      const noRemote = rendered.indexOf("No remote, or no `gh` login:");
      const closing = rendered.indexOf(VERBATIM_LINES["the closing line"]);
      expect(closing).toBeGreaterThan(noRemote);
    });

    /** @scenario "Chat about this ends the turn on the line alone" */
    it("answers Chat about this with the line alone and ends the turn", () => {
      expect(rendered).toContain(
        "say the line below with `say`, verbatim and in full, and end the turn right after that call, so the composer takes the cursor and the turn waits for their description. The line is the whole of the turn's words: no reply text before or after it, no other tool call, and never an empty turn in its place:",
      );
    });

    /** @scenario "Langy names the framework it found" */
    it("says one line naming the framework and the file before the first edit", () => {
      expect(rendered).toContain(
        'then keep one line naming what you found, in this shape: "I found a LangGraph agent in app/graph.py." That is the framework line: it is said with `say` right before the question of step 3, with the two lines of item 8.',
      );
      const report = rendered.indexOf("keep one line naming what you found");
      const branch = rendered.indexOf("`git checkout -b langy/<slug> origin/<default>`");
      expect(report).toBeGreaterThan(-1);
      expect(branch).toBeGreaterThan(report);
    });

    /** @scenario "The proposal is the gate of step 4" */
    it("asks the proposal before any scenario command, whatever message arrives first", () => {
      expect(rendered).toContain(
        "This question is the gate of step 4: no `scenario create`, no run and no suite before the person has answered it.",
      );
      expect(rendered).toContain(
        "a scenario the person described before the question becomes `{title}` in it, and the answer is still theirs to give",
      );
      expect(rendered).toContain("After that pick, their next message describes the scenario.");
      expect(rendered).toContain(
        'On the create option, or on the scenario agreed after "Chat about this", the next thing you do is this list, then the first command',
      );
    });

    /** @scenario "The skills are loaded, not recalled" */
    it("loads the tracing and connect-agent skills with the skill tool and carries the key check command itself", () => {
      expect(rendered).toContain(
        "load the `tracing` and `connect-agent` skills with the `skill` tool, then, in this order:",
      );
      expect(rendered).toContain(
        `uv run python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(bool(os.getenv('LANGWATCH_API_KEY')))"`,
      );
      expect(rendered).toContain("never `python -` with a heredoc");
      expect(rendered).toContain("`False` is not a failed step: fix the load order of item 2 and run the same command again.");
    });

    /** @scenario "The connect endpoint comes from the connect-agent skill" */
    it("never searches the docs for a connect-agent page and reads one framework page only", () => {
      expect(rendered).toContain(
        "The skill carries the whole pattern and there is no docs page for it: never search `langwatch docs` for one.",
      );
      expect(rendered).toContain("and no other. Keep the order the tracing skill pins");
    });

    /** @scenario "The path ends in a fixed order" */
    it("states the end of the path as one fixed order", () => {
      const order = [
        'git commit -m "Add LangWatch tracing and the connect endpoint"',
        "Push the branch and open the pull request",
        VERBATIM_LINES["the pull request line"],
        VERBATIM_LINES["the proposal"],
        'langwatch scenario create "<title>"',
        "langwatch navigate open <scenario_id>",
        VERBATIM_LINES["the why-a-scenario line"],
        "langwatch scenario run <scenario_id>",
        VERBATIM_LINES["the two-things line"],
        'langwatch test-suite create "Full regression"',
        "langwatch test-suite run <suite_id>",
        "langwatch navigate open <the scenariorun_ id the suite run printed>",
        "langwatch onboarding complete-path llmops",
        VERBATIM_LINES["the closing line"],
      ];
      const positions = order.map((line) => rendered.indexOf(line));
      for (const [index, position] of positions.entries()) {
        expect(position, order[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]!);
      }
    });

    /** @scenario "A failed first run still gets the two-things line" */
    it("says the two-things line after a failed verdict, and only an error skips it", () => {
      expect(rendered).toContain(
        "a run that answers a verdict, passed or failed, gets the two-things line.",
      );
      expect(rendered).toContain(
        "**If the run failed**, the explanation comes first, said with `say`: in plain words what the judge saw and why the agent did not meet the criteria, pointing at the run so they can replay the conversation.",
      );
      expect(rendered).toContain(
        "the agent answered and the traces flowed, which is what the line says.",
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
        "say in one line, with `say`, what is not done and what the error names as the cause, and end the turn",
      );
      expect(section).toContain("stop there, without diagnosing");
      expect(section).toContain("never the env file:");
      expect(section).not.toContain("never the env file or the process log");
      expect(section).toContain("`langwatch onboarding complete-path` does not run");
      expect(section).toContain(
        "the why-a-scenario line, the two-things line and the closing line are not said",
      );
      expect(section).toContain("a scenario or suite run answers an error instead of a verdict");
      expect(section).toContain(
        "A step fails when a command answers an error, never when a judge answers a verdict",
      );
      expect(rendered).toContain(
        "never one that stopped at a failed step",
      );
    });

    /** @scenario "An agent that never comes online is explained by its own output" */
    it("reports what the agent process printed when it does not come online, never a guess", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain(
        "when the agent is not online after two minutes, the cause is in the agent process itself, so read the log the background command named",
      );
      expect(section).toContain("report its last lines, the exception if there is one, as the reason");
      expect(section).toContain("Never a guess about the CLI, the login or the project in its place");
    });

    /** @scenario "LangWatch initialises after the project's environment is loaded" */
    it("keeps the tracing skill's order between the env loader and setup, and checks the key before the start", () => {
      expect(rendered).toContain(
        "`langwatch.setup()` sits below the import that loads the env file, never at the top of the entry file",
      );
      const check = rendered.indexOf(
        "Run the tracing skill's key check once, copied as written for the language",
      );
      const start = rendered.indexOf("Start the agent from that branch");
      expect(check).toBeGreaterThan(-1);
      expect(start).toBeGreaterThan(check);
      expect(rendered).toContain(
        "One run: never a second try with another path or another loader, and no probe of your own before it.",
      );
      expect(rendered).toContain("It is the first and only check");
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
