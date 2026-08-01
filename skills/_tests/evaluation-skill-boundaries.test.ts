import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const readSkill = (name: string) =>
	fs.readFileSync(path.join(skillsRoot, name, "SKILL.mdx"), "utf8");
const readCompiledSkill = (name: string) =>
	fs.readFileSync(
		path.join(skillsRoot, "_compiled", `${name}.docs.txt`),
		"utf8",
	);

describe("evaluation skill boundaries", () => {
	/** @scenario Use the experiments skill for batch testing */
	it("keeps experiments focused on batch testing", () => {
		const source = readSkill("experiments");

		expect(source).toContain("langwatch.experiments.init");
		expect(source).toContain(
			"npx skills@1.5.19 add langwatch/skills/online-evaluations",
		);
		expect(source).not.toContain("langwatch monitor create <name>");
		expect(source).not.toContain("as_guardrail=True");
	});

	/** @scenario Use the online evaluations skill for production monitoring and enforcement */
	it("keeps online evaluations focused on production traffic", () => {
		const source = readSkill("online-evaluations");

		expect(source).toContain("langwatch monitor create --help");
		expect(source).toContain("as_guardrail=True");
		expect(source).toContain(
			"npx skills@1.5.19 add langwatch/skills/experiments",
		);
		expect(source).not.toContain("langwatch.experiments.init");
	});

	/** @scenario Route legacy evaluation skill requests without mixing workflows */
	it("keeps the legacy evaluations skill as a small router", () => {
		const source = readSkill("evaluations");

		// Content quality (ask-first on ambiguity, validation self-recovery) is
		// covered by the dogfood scenarios, not by echoing prose back here.
		expect(source.length).toBeLessThan(3_000);
		expect(source).toContain("langwatch/skills/experiments");
		expect(source).toContain("langwatch/skills/online-evaluations");
		expect(source).not.toContain("langwatch.experiments.init");
		expect(source).not.toContain("langwatch monitor create");
	});

	/** @scenario An ambiguous evaluation request is asked as a choices block */
	it("asks the experiment-vs-evaluator question as a choices block", () => {
		const source = readSkill("evaluations");

		// The agent's own rules make a `choices` block the ONLY sanctioned way to
		// put a user-owned decision to the user, and "which of these gets tested"
		// is exactly that decision. While this skill taught prose instead, it was
		// asking the agent to break rule 3 to follow this skill.
		expect(source).toContain('"kind": "choices"');
		expect(source).toContain("langy-card");
		expect(source).not.toContain("Send the question as a single line of prose");
	});

	it("organizes the dogfood scenarios into focused files", () => {
		const scenarioFiles = fs
			.readdirSync(__dirname)
			.filter((file) => file.endsWith(".scenario.test.ts"));

		expect(
			scenarioFiles.filter((file) => file.startsWith("experiments-")),
		).toHaveLength(5);
		expect(scenarioFiles).toContain("online-evaluations.scenario.test.ts");
	});

	it("keeps both focused evaluation workflows in the full level-up skill", () => {
		const compiled = readCompiledSkill("level-up");

		expect(compiled).toContain("# Run Experiments for Your Agent");
		expect(compiled).toContain("# Set Up Online Evaluations and Guardrails");
	});
});
