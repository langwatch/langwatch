import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	createSkillTestWorkDir,
	ensureClaudeSkillInstructions,
	installSkillToWorkDir,
	removeSkillTestWorkDir,
} from "./helpers/claude-code-adapter";

describe("Claude Code skill discovery", () => {
	it("preserves existing instructions and appends each missing skill once", () => {
		const workingDirectory = createSkillTestWorkDir(
			"claude-skill-discovery-",
		);
		try {
			fs.writeFileSync(
				path.join(workingDirectory, "CLAUDE.md"),
				"Keep these existing project instructions.\n",
			);
			installSkillToWorkDir({
				workingDirectory,
				skillSubpath: "experiments",
			});
			installSkillToWorkDir({
				workingDirectory,
				skillSubpath: "online-evaluations",
			});

			ensureClaudeSkillInstructions(workingDirectory);
			ensureClaudeSkillInstructions(workingDirectory);

			const contents = fs.readFileSync(
				path.join(workingDirectory, "CLAUDE.md"),
				"utf8",
			);
			expect(contents).toContain("Keep these existing project instructions.");
			expect(contents.match(/\.skills\/experiments\/SKILL\.md/g)).toHaveLength(
				1,
			);
			expect(
				contents.match(/\.skills\/online-evaluations\/SKILL\.md/g),
			).toHaveLength(1);
		} finally {
			removeSkillTestWorkDir(workingDirectory);
		}
	});

	describe("given dogfood artifact preservation is enabled", () => {
		it("keeps the generated workspace available for inspection", () => {
			const workingDirectory = createSkillTestWorkDir(
				"claude-skill-preservation-",
			);
			const previousValue = process.env.KEEP_SKILL_TEST_WORKDIR;
			try {
				process.env.KEEP_SKILL_TEST_WORKDIR = "1";
				removeSkillTestWorkDir(workingDirectory);
				expect(fs.existsSync(workingDirectory)).toBe(true);
			} finally {
				if (previousValue === undefined) {
					delete process.env.KEEP_SKILL_TEST_WORKDIR;
				} else {
					process.env.KEEP_SKILL_TEST_WORKDIR = previousValue;
				}
				fs.rmSync(workingDirectory, { recursive: true, force: true });
			}
		});
	});
});
