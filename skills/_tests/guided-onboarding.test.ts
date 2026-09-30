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
  "the failed-open line":
    "The branch {branch} is pushed; opening the pull request failed with: {error}.",
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
  "the governance line": "Let me know if I can help you with anything! You can ask here",
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
        "These three lines of step 2, the framework line, the pull request line, the no-remote line or the failed-open line, and the branch line, are said with the `say` tool, one call each, in that order, in this same step, right after the pull request command answered and right before the question of step 3: never after the answer, and never in the reply text.",
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

    /** @scenario "The governance path ends with one line" */
    it("closes the governance path with no question and no page opened, then the one line", () => {
      const section = rendered.slice(
        rendered.indexOf("## governance: Governance"),
      );
      expect(section).toContain(
        "this path has no setup of its own: no question, no page opened, no command on the pages",
      );
      expect(section).not.toContain("`question`");
      expect(section).not.toContain("langwatch navigate");
      expect(section).toContain(VERBATIM_LINES["the governance line"]);
      expect(section.indexOf(VERBATIM_LINES["the governance line"])).toBeGreaterThan(
        section.indexOf("langwatch onboarding complete-path governance"),
      );
    });

    it("ends every path by recording its completion", () => {
      for (const p of ["llmops", "coding", "gateway", "governance"]) {
        expect(rendered).toContain(`langwatch onboarding complete-path ${p}`);
      }
    });

    /** @scenario "Every path ends by recording its completion" */
    it("runs complete-path before the closing line on every path, so the line is what follows the call", () => {
      expect(rendered).toContain(
        "It runs right before the closing line, in the same step, with no other tool call beside it but the plan write that marks its item done, and never before the path's work is done.",
      );
      expect(rendered).toContain(
        "When it returns, say the closing line with `say`, verbatim, as the last thing the turn does, and the turn is over: no reply text after it, and never the line twice.",
      );
      const endings: Array<[string, string]> = [
        ["langwatch onboarding complete-path llmops", VERBATIM_LINES["the closing line"]],
        ["langwatch onboarding complete-path coding", VERBATIM_LINES["the coding closer"]],
        ["langwatch onboarding complete-path governance", VERBATIM_LINES["the governance line"]],
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
      const online = rendered.indexOf("run `langwatch agent list --wait-online \"<agent name>\" --format json` once");
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
        "On one of those, and only then, this line takes the pull request line's place, verbatim, with the brace filled with the branch name, and the step is done:",
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

    /** @scenario "Step 3 begins in the turn that closes step 2" */
    it("follows the branch line with the bare question in the same turn, and never ends a turn on the lines", () => {
      expect(rendered).toContain(
        "The list ends at the lines; the turn does not. The write that marks item 11 done comes right after the three lines and right before the bare question of step 3, in the same turn, and the card is what ends the turn, never the branch line: a turn that ends on the branch line, with no card under it, has skipped step 3, whatever the list says.",
      );
      expect(rendered).toContain(
        "ends with no reply text at all, and with no early end either: the last call of the turn is the bare question of step 3, the closing line of the path, or the one line of a failed step, and the empty reply comes after that call, never in its place.",
      );
      const branchLine = rendered.indexOf(
        "I left branch {branch} checked out: the agent you started runs on it.",
      );
      const sameTurn = rendered.indexOf(
        "The proposal of step 3 comes right after them, in the same turn.",
      );
      const proposal = rendered.indexOf("### 3. Propose the first scenario, and stop");
      expect(branchLine).toBeGreaterThan(-1);
      expect(sameTurn).toBeGreaterThan(branchLine);
      expect(proposal).toBeGreaterThan(sameTurn);
    });

    /** @scenario "The plan card reaches all items done before the closing lines" */
    it("rewrites the plan after every finished item, and marks the last one done before the card or the closing line", () => {
      expect(rendered).toContain("**Keep the plan current.**");
      expect(rendered).toContain(
        "written again, whole, the moment an item is finished: one write per finished item, never two items ticked in one write, and every call carries the full list, since the tool replaces it.",
      );
      expect(rendered).toContain(
        "The write that marks the last item done comes before the call that ends the turn, the bare question of step 3 or the closing line of the path: the card and the line are read under a list that says all done, never under one with items open.",
      );
      expect(rendered).toContain(
        "The write that marks item 10 done comes between `langwatch onboarding complete-path` and the closing line: the line is said under a list that reads all done, and it stays the last call of the turn.",
      );
      expect(rendered).toContain(
        "with no other tool call beside it but the plan write that marks its item done",
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
        "1. Install the package, as step 2 of the `tracing` skill says for the language, from the project root, through the project's own package manager. For Python the install is a ladder, not one command, and the manager the workspace facts name is its first rung: `uv add langwatch` when the facts name uv, when the folder has a `uv.lock`, or when `.venv/pyvenv.cfg` carries a `uv =` line (a virtual environment uv made has no pip in it); otherwise the folder's own interpreter, `.venv/bin/python -m pip install langwatch` when `.venv` exists; and only after those the interpreter's pip, `pip install langwatch`, `pip3 install langwatch`, `python3 -m pip install langwatch`, `python -m pip install langwatch`, stopping at the first that works. The interpreter's pip never runs before the named manager or the folder's own interpreter.",
      );
      const tracingStep = rendered.indexOf("2. `tracing` for the detected framework.");
      expect(how).toBeGreaterThan(-1);
      expect(tracingStep).toBeGreaterThan(how);
      expect(rendered).toContain("The item is done when the project's manifest names the package.");
      expect(rendered).toContain(
        "the manifest the install of item 1 changed or you wrote the package line into, `requirements.txt` included, and the lockfile it changed, unless the repository ignores it, the tracing edit, the connect adapter",
      );
    });

    /** @scenario "A pip project's manifest gets the package line" */
    it("writes the langwatch line into the requirements file itself, since a pip install writes no manifest", () => {
      expect(rendered).toContain(
        "`uv add`, `npm install` and the other managers write it themselves; a pip install writes nothing, so for a pip project the manifest is `requirements.txt` (or the file the folder uses, such as `requirements/base.txt`) and you write the line into it yourself: read the version with `python -m pip show langwatch` through the interpreter the install worked with, then add `langwatch==<installed version>`, pinned the way the file pins its other packages, and unpinned when the file pins none of them.",
      );
      // The commit stages that manifest, whatever the file is called.
      expect(rendered).toContain(
        "the manifest the install of item 1 changed or you wrote the package line into, `requirements.txt` included",
      );
    });

    /** @scenario "A repository with no remote branches from the local default" */
    it("branches with no start point when the tree is dirty or the facts say the repository has no remote", () => {
      expect(rendered).toContain(
        "`git checkout -b langy/<slug> origin/<default>` (with no start point when the tree is dirty or the workspace facts say `git remote: none`)",
      );
    });

    /** @scenario "The wait for the agent gets more room than it takes" */
    it("runs the wait with a shell timeout above the wait itself, so the CLI's own line is what it reads", () => {
      expect(rendered).toContain(
        "run `langwatch agent list --wait-online \"<agent name>\" --format json` once, with the `timeout` parameter of the shell tool set to 150:",
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

    /** @scenario "The adapter is the SDK connect call" */
    it("writes the adapter as the SDK connect call and never as a route", () => {
      expect(rendered).toContain(
        "On this path the SDK is always installed, item 3 of the checklist, so the adapter is the SDK connect call: the `@langwatch.connect_agent` decorator in Python, `connectAgent` in TypeScript.",
      );
      expect(rendered).toContain(
        "The HTTP fallback at the bottom of `connect-agent` is never used here: a route on a path, `@app.post(\"/langwatch/connect\")` or the like, registers nothing with the SDK",
      );
      expect(rendered).toContain("A route is not an adapter.");
    });

    /** @scenario "A clean log with no online row means the adapter did not register" */
    it("repairs a wait that fails on a clean start by rewriting the adapter as the SDK call", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      const cleanLog = section.indexOf(
        "A log that shows a clean start, the server up and no exception, with the row never online means the adapter did not register with the SDK, which is your own work of this step too: the repair is to rewrite the adapter as the SDK connect call of item 3, start the agent again and run the wait once more.",
      );
      const once = section.indexOf("The repair happens once and never touches the env file or reads the key");
      expect(cleanLog).toBeGreaterThan(-1);
      expect(once).toBeGreaterThan(cleanLog);
    });

    /** @scenario "The pull request body is written before it is read, and the no-remote line waits for its reason" */
    it("writes the body file before the command that reads it, and says the no-remote line only for the reason the output named", () => {
      const body = rendered.indexOf(
        "The body goes in a file: write `.langwatch/pr-body.md` with `local_write` first, and only then the command that reads it with `--body-file`",
      );
      const branch = rendered.indexOf("Then run `git branch --show-current`: its output is the name the lines below carry.");
      expect(body).toBeGreaterThan(-1);
      expect(branch).toBeGreaterThan(body);
      const rule = rendered.indexOf(
        "**A push that printed a new branch on a remote (`* [new branch] ... -> ...`) means the no-remote line is never said, whatever `gh` prints afterwards.**",
      );
      expect(rule).toBeGreaterThan(-1);
      expect(rendered).toContain("a reason the output did not name is never said");
      // The push and the pull request are two commands, so the push's own
      // answer is what the rule reads.
      const twoCommands = rendered.indexOf(
        "The push and the pull request are two commands, `git push` first and `gh pr create` after it, never joined with `&&` or `;`: each is read on its own exit code and its own output, and a joined command that exits 1 hides which of the two failed.",
      );
      expect(twoCommands).toBeGreaterThan(-1);
      expect(twoCommands).toBeLessThan(rule);
      expect(rendered).toContain(
        "whatever `gh` prints afterwards.** That rule is read against the push command's own answer.",
      );
      expect(rendered).toContain(
        "The no-remote line has exactly two triggers, quoted as git and gh print them: `git push` with no remote, \"fatal: No configured push destination.\" or \"'origin' does not appear to be a git repository\", and `gh` not signed in, \"To get started with GitHub CLI, please run:  gh auth login\" or \"You are not logged into any GitHub hosts\".",
      );
      expect(rendered).toContain(
        "After a push that worked, a `gh` failure is the failed-open line. \"none of the git remotes configured for this repository point to a known GitHub host\" has nothing to fix and gets no retry: the line is said at once with that sentence in the brace.",
      );
      expect(rendered).toContain(
        "Any other `gh` error, a missing body file, a wrong base, gets one fix of its cause and one retry of the command; when it still fails, this line, verbatim, takes the place of both, with the second brace filled with the one line the command printed, and the step is done:",
      );
      // The rule comes before both lines it decides between.
      expect(rendered.indexOf(VERBATIM_LINES["the no-remote line"])).toBeGreaterThan(rule);
      expect(rendered).not.toContain("No remote, or no `gh` login:");
      expect(rendered).not.toContain("answered that there is no remote");
      const noRemote = rendered.indexOf(VERBATIM_LINES["the no-remote line"]);
      const failedOpen = rendered.indexOf(VERBATIM_LINES["the failed-open line"]);
      const branchLine = rendered.indexOf(VERBATIM_LINES["the branch line"]);
      expect(failedOpen).toBeGreaterThan(noRemote);
      expect(branchLine).toBeGreaterThan(failedOpen);
      expect(VERBATIM_LINES["the failed-open line"].match(/\{[a-z]+\}/g)).toEqual(["{branch}", "{error}"]);
    });

    /** @scenario "An env file is never printed" */
    it("never prints an env file, and reads its names alone when they matter", () => {
      expect(rendered).toContain(
        "An env file is never printed, with `cat` or any other command: the terminal that runs it is shared, and a key printed there is a key shown.",
      );
      expect(rendered).toContain(
        "read them alone with a command that prints keys and no values, such as `sed 's/=.*//' .env`.",
      );
    });

    /** @scenario "The connect adapter wraps the existing entry point and leaves its callers working" */
    it("adds the adapter as a new decorated function around the entry point, never by changing a function other code calls", () => {
      expect(rendered).toContain(
        "The adapter is a new function, decorated with the one connect call, that calls the existing entry point and returns the reply text. Functions the repository already has keep their signature and their return value: instrumentation is added around them, never by changing them. One connect call per agent, so exactly one decorated function.",
      );
      expect(rendered).toContain(
        "Before the commit, read every caller of each function you touched (grep its name across the repository) and, when the repository has tests, run them: a caller that reads a shape the edit changed is the edit being wrong, not the caller.",
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
        "run `langwatch agent list --wait-online \"<agent name>\" --format json` once",
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
        "On one of those, and only then, this line takes the pull request line's place, verbatim, with the brace filled with the branch name, and the step is done:",
      );
      const noRemote = rendered.indexOf("The no-remote line has exactly two triggers");
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
      expect(rendered).toContain(
        "It is said there and nowhere earlier: not when the code is read, and not again after a repair; a line said twice is a line said wrong.",
      );
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

    /** @scenario "A folder that is not a repository gets the offer to make it one" */
    it("asks about git init instead of stopping when the folder is not a repository", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain(
        "an unlock is asked, never stopped on: ask with the `question` tool, one option that does the unlock for you and one that lets the person go another way, both plain answers with no `ref`, the turn ends on the card, and the answer is acted on in the next turn.",
      );
      expect(section).toContain(
        "This folder isn't a git repository yet, so I can't make a branch for the tracing change. Want me to create one?",
      );
      expect(section).toContain(
        'Options, in this order: "Create a repository for me" and "I\'ll choose another folder".',
      );
      expect(section).toContain(
        'On "Create a repository for me": `git init`; when the folder has no `.gitignore`, write one with `local_write` naming `.env`, `node_modules/`, `.venv/` and `__pycache__/`, so the first commit never carries a key; then `git add -A` and `git commit -m "Initial commit"`, one command each, in the shared folder.',
      );
      expect(section).toContain(
        "Then step 2 continues on the langy branch exactly as the no-remote path says: `git checkout -b langy/<slug>` from the branch `git init` made, no `git fetch`, no `git push`, and the no-remote line takes the pull request line's place.",
      );
      expect(section).toContain(
        'On "I\'ll choose another folder": end the turn saying which folder to connect next through the code access card, and nothing else runs.',
      );
      expect(section).toContain("`gh` not signed in is not a dead end");
      expect(rendered).toContain(
        "When the workspace facts say `git: not a repository`, there is no branch to make: that is the first unlock question of \"When a step fails\", asked before any command of this step.",
      );
    });

    /** @scenario "The manager the facts name is the first rung of the install ladder" */
    it("installs through the manager the facts name before any pip spelling", () => {
      expect(rendered).toContain(
        "the manager the workspace facts name is its first rung: `uv add langwatch` when the facts name uv, when the folder has a `uv.lock`, or when `.venv/pyvenv.cfg` carries a `uv =` line (a virtual environment uv made has no pip in it)",
      );
      expect(rendered).toContain(
        "The interpreter's pip never runs before the named manager or the folder's own interpreter.",
      );
      const tracing = renderSkill(
        listNativeSkills(skillsRoot).find((s) => s.slug === "tracing")!,
      );
      expect(tracing).toContain(
        "the manager the workspace facts name is its first rung: `uv add langwatch` when the facts name uv, the folder has a `uv.lock` or `.venv/pyvenv.cfg` carries a `uv =` line",
      );
    });

    /** @scenario "A missing pip climbs the install ladder before it asks" */
    it("climbs the Python install ladder on a command not found and asks only when every rung is missing", () => {
      expect(rendered).toContain(
        "Each attempt is one command, and a command not found (exit 127, \"command not found\") moves to the next rung without a retry: it is a missing spelling, never a missing capability.",
      );
      expect(rendered).toContain(
        "For JavaScript, `npm install langwatch` when no lockfile names another manager, `pnpm add langwatch`, `yarn add langwatch` or `bun add langwatch` by the lockfile, and a 127 on the named manager falls back to `npm`.",
      );
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain(
        "I couldn't find pip or uv on this machine, so I can't install the LangWatch package. Want me to install uv?",
      );
      expect(section).toContain(
        'Options, in this order: "Install uv for me" and "I\'ll set up Python myself".',
      );
      expect(section).toContain(
        'On "Install uv for me": run the official installer, `curl -LsSf https://astral.sh/uv/install.sh | sh`, then `uv init` when the folder has no `pyproject.toml`, then `uv add langwatch`, and item 1 goes on.',
      );
      expect(section).toContain(
        'On "I\'ll set up Python myself": end the turn saying what to install, Python 3 with pip or uv, and to send a message when it is done.',
      );
    });

    /** @scenario "The install is checked for the API before code is written" */
    it("checks the installed package for the API before any code is written against it", () => {
      expect(rendered).toContain(
        "Then, before any code edit, check that the installed package carries the API, through the interpreter the install worked with: `python -c \"import langwatch; langwatch.setup; langwatch.connect_agent\"` for Python (`.venv/bin/python -c` when `.venv` exists, `uv run python -c` for a uv project), `node -e \"require('langwatch')\"` for JavaScript.",
      );
      expect(rendered).toContain(
        "`uv run` is the runner only in a uv project, one where the facts name uv or the folder has a `pyproject.toml` or a `uv.lock`; anywhere else a Python command runs through the interpreter the ladder worked with, `.venv/bin/python` when `.venv` exists, else the `python` or `python3` whose pip installed the package, and never through `uv run`, which in a folder with no project file builds an environment of its own, with nothing of what the ladder installed in it.",
      );
      expect(rendered).toContain(
        "through the runner item 1 settled on, so `.venv/bin/python -c` or `python -c` in place of `uv run python -c` outside a uv project.",
      );
      expect(rendered).toContain(
        "A Python release below 1.3.0 has neither `setup` nor `connect_agent`, and pip installs one without a word when the interpreter is newer than the SDK supports: every release with the API declares an upper Python bound, so pip walks back to the last release with none and reports success.",
      );
      expect(rendered).toContain(
        "`pip install langwatch --upgrade` never runs there: that interpreter has no newer release to get.",
      );
      const tracing = renderSkill(
        listNativeSkills(skillsRoot).find((s) => s.slug === "tracing")!,
      );
      expect(tracing).toContain(
        "Before any code is written against it, check the install carries the API through the interpreter that installed it: `python -c \"import langwatch; langwatch.setup; langwatch.connect_agent\"` for Python, `node -e \"require('langwatch')\"` for TypeScript.",
      );
      expect(tracing).toContain("`pip install langwatch --upgrade` cannot help there.");
    });

    /** @scenario "An installed SDK without the tracing API is an interpreter question, not a stop" */
    it("asks about the interpreter when the installed SDK has no tracing API", () => {
      expect(rendered).toContain(
        "When the check fails, or the version the show command reads (`python -m pip show langwatch`, `uv pip show langwatch`) is below 1.3.0, the cause is the interpreter, and that is the third unlock question of \"When a step fails\", asked before any edit.",
      );
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      expect(section).toContain("Three dead ends have a known unlock, and an unlock is asked, never stopped on:");
      expect(section).toContain(
        "The third: the check of item 1 fails, or the installed version is below 1.3.0, after an install that reported success.",
      );
      expect(section).toContain(
        "Your Python 3.14 is newer than the LangWatch SDK supports, so pip installed an old release without the tracing API. Want me to set up a supported Python for this folder?",
      );
      expect(section).toContain(
        "Options, in this order: \"Install Python 3.13 with uv for me\" and \"I'll pick the interpreter myself\".",
      );
      expect(section).toContain(
        "On \"Install Python 3.13 with uv for me\": `uv python install 3.13` (when `uv` is a command not found, the installer of the second question runs first), then the ladder's uv rung against that interpreter: `uv add --python 3.13 langwatch` when the folder has a `pyproject.toml`; `uv venv --python 3.13` then `uv pip install langwatch` when it has none, and the manifest line of item 1 goes into the requirements file as for any pip project.",
      );
      expect(section).toContain(
        "Then the check of item 1 runs again through `.venv/bin/python`, and item 1 goes on; the agent of item 6 starts through that interpreter, `uv run` or `.venv/bin/python`, never the machine's `python3`.",
      );
      expect(section).toContain(
        "On \"I'll pick the interpreter myself\": end the turn saying that the SDK needs a Python it supports, 3.13 today, and to send a message when the folder's interpreter is one.",
      );
      expect(section).toContain("and no `--upgrade` can change that");
    });

    /** @scenario "A chosen name is quoted in every command that carries it" */
    it("quotes the agent name in the wait, the run and the suite run", () => {
      expect(rendered).toContain(
        'run `langwatch agent list --wait-online "<agent name>" --format json` once',
      );
      expect(rendered).toContain(
        'langwatch scenario run <scenario_id> --target "connected:<agent name>" --wait --format json',
      );
      expect(rendered).toContain(
        'langwatch test-suite run <suite_id> --target "connected:<agent name>" --wait --format json',
      );
      expect(rendered).toContain(
        "a name with a space passed bare is read as two arguments, and the command never runs",
      );
      expect(rendered).not.toContain("--wait-online <agent name>");
      expect(rendered).not.toContain("--target connected:<agent name>");
      const skillNamed = (slug: string) =>
        renderSkill(
          (listNativeSkills(skillsRoot).find((s) => s.slug === slug) ??
            listPublishedSkills(skillsRoot).find((s) => s.slug === slug))!,
        );
      const connectAgent = skillNamed("connect-agent");
      expect(connectAgent).toContain('--target "connected:ACME checkout"');
      expect(connectAgent).toContain('--wait-online "ACME checkout"');
      const scenarios = skillNamed("scenarios");
      expect(scenarios).toContain(
        'A name with a space is quoted whole: `--target "connected:ACME checkout"`.',
      );
    });

    /** @scenario "A command Langy wrote wrong is rerun, not reported as a failed step" */
    it("reruns a command it wrote wrong instead of reporting a failed step", () => {
      const failed = rendered.indexOf("### When a step fails");
      const section = rendered.slice(failed, rendered.indexOf("## coding: Coding agents"));
      const rule = "A command that fails for a cause you can act on from what you already know is fixed and run once more, never reported.";
      expect(section).toContain(rule);
      expect(section).toContain(
        "The command was written wrong: a usage error, `too many arguments`, `unknown option`, `missing required argument`, an exit code 2 with the usage printed, so fix the shape, a name with a space in double quotes.",
      );
      expect(section).toContain(
        "A spelling was missing: a command not found, so the next rung of the ladder.",
      );
      expect(section).toContain(
        "A module or dependency the folder declares is missing: `ModuleNotFoundError`, `Cannot find module`, so install what the folder declares through the interpreter or manager that worked, `uv sync`, `python -m pip install -r requirements.txt`, `npm install`, and run the same command again through the interpreter the install went into: a command that ran under one runner and a package installed through another are two environments, and rerunning the first is a second failure of the same kind by construction, so a `uv run` that failed on a module in a folder with no project file reruns as `python -c` through the interpreter whose pip installed it.",
      );
      expect(section).toContain(
        "One fix and one rerun per command: a second failure of the same kind is a failed step, and the unlock question of this section, when one covers it, comes before any stop.",
      );
      // The reply two films ended on: a status line naming the cause, no fix
      // tried, no question asked, and the turn closed.
      expect(section).toContain(
        'A `say` that ends the turn on what is "not done yet because" of a cause like these, with no fix tried and no question asked, is never the reply.',
      );
      expect(section.indexOf(rule)).toBeLessThan(
        section.indexOf("A step fails when a command answers an error, never when a judge answers a verdict"),
      );
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
