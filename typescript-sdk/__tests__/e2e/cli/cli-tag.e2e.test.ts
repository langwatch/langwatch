// @vitest-environment node
// @vitest-config ./vitest.e2e.config.mts

import {
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  afterAll,
  beforeAll,
} from "vitest";
import * as fs from "fs";
import * as path from "path";

import { config } from "dotenv";
import {
  expectations,
  CliRunner,
  PROMPT_NAME_PREFIX,
  PromptFileManager,
} from "./helpers";
import { LangWatch } from "../../../dist";
import { ApiHelpers } from "./helpers/api-helpers";

config({ path: ".env.test", override: true });

const { expectCliResultSuccess } = expectations;
const TMP_BASE_DIR = path.join(__dirname, "tmp", "tag");

interface Tag {
  name: string;
}

const createUniquePromptName = () => {
  return `${PROMPT_NAME_PREFIX}-${Date.now()}`;
};

const createdTagNames = new Set<string>();

const createUniqueTagName = () => {
  const name = `e2e-tag-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  createdTagNames.add(name);
  return name;
};

describe("CLI E2E", () => {
  let testDir: string;
  let originalCwd: string;
  let langwatch: LangWatch;
  let cli: CliRunner;

  beforeAll(() => {
    if (fs.existsSync(TMP_BASE_DIR)) {
      fs.rmSync(TMP_BASE_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });
    fs.mkdirSync(TMP_BASE_DIR, { recursive: true });
    testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "langwatch-tag-"));
    originalCwd = process.cwd();
    process.chdir(testDir);
    cli = new CliRunner({ cwd: testDir });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
  });

  afterAll(async () => {
    const apiHelpers = new ApiHelpers(langwatch);
    await apiHelpers.cleapUpTestPrompts();
    // Only delete tags created by this test run to avoid interference with parallel runs
    await Promise.all(
      [...createdTagNames].map((name) =>
        langwatch.prompts.tags.delete(name).catch(() => undefined),
      ),
    );
  });

  describe("tag", () => {
    describe("tag create", () => {
      describe("when creating a valid tag", () => {
        it("creates the tag and confirms", async () => {
          const tagName = createUniqueTagName();

          const result = cli.run(`prompt tag create ${tagName}`);

          expectCliResultSuccess(result);
          expect(result.output).toContain("Created tag:");

          const tags = await langwatch.prompts.tags.list();
          expect(tags.some((t: Tag) => t.name === tagName)).toBe(true);

          await langwatch.prompts.tags.delete(tagName);
        }, 60_000);
      });

      describe("when creating a tag with invalid name", () => {
        it("exits with error without calling API", () => {
          const result = cli.run("prompt tag create INVALID_NAME!");

          expect(result.success).toBe(false);
          expect(result.exitCode).toBe(1);
          expect(result.output).toContain("Invalid tag name");
        }, 60_000);
      });
    });

    describe("tag list", () => {
      describe("when tags exist", () => {
        it("displays tags in a table", async () => {
          const tagName = createUniqueTagName();
          await langwatch.prompts.tags.create({ name: tagName });

          const result = cli.run("prompt tag list");

          expectCliResultSuccess(result);
          expect(result.output).toContain(tagName);

          await langwatch.prompts.tags.delete(tagName);
        }, 60_000);
      });
    });

    describe("tag rename", () => {
      describe("when renaming an existing tag", () => {
        it("renames the tag", async () => {
          const oldName = createUniqueTagName();
          const newName = createUniqueTagName();
          await langwatch.prompts.tags.create({ name: oldName });

          const result = cli.run(`prompt tag rename ${oldName} ${newName}`);

          expectCliResultSuccess(result);
          expect(result.output).toContain("Renamed tag:");

          const tags = await langwatch.prompts.tags.list();
          expect(tags.some((t: Tag) => t.name === newName)).toBe(true);
          expect(tags.some((t: Tag) => t.name === oldName)).toBe(false);

          await langwatch.prompts.tags.delete(newName);
        }, 60_000);
      });
    });

    describe("tag assign", () => {
      describe("when assigning a tag to a prompt version", () => {
        it("assigns the tag to the latest version", async () => {
          const handle = createUniquePromptName();
          const tagName = createUniqueTagName();

          await langwatch.prompts.create({
            handle,
            prompt: "Test",
          });
          await langwatch.prompts.tags.create({ name: tagName });

          try {
            const result = cli.run(`prompt tag assign ${handle} ${tagName}`);

            expectCliResultSuccess(result);
            expect(result.output).toContain("Assigned tag");

            const tagged = await langwatch.prompts.get(handle, {
              tag: tagName,
            });
            expect(tagged).not.toBeNull();
          } finally {
            await langwatch.prompts.delete(handle).catch(() => undefined);
            await langwatch.prompts.tags.delete(tagName).catch(() => undefined);
          }
        }, 60_000);
      });

      describe("when assigning a tag to a specific version", () => {
        it("assigns the tag to that version", async () => {
          const handle = createUniquePromptName();
          const tagName = createUniqueTagName();

          await langwatch.prompts.create({
            handle,
            prompt: "Version 1",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2",
            commitMessage: "v2",
          });
          await langwatch.prompts.tags.create({ name: tagName });

          try {
            const result = cli.run(
              `prompt tag assign ${handle} ${tagName} --version 1`,
            );

            expectCliResultSuccess(result);

            const tagged = await langwatch.prompts.get(handle, {
              tag: tagName,
            });
            expect(tagged.prompt).toContain("Version 1");
          } finally {
            await langwatch.prompts.delete(handle).catch(() => undefined);
            await langwatch.prompts.tags.delete(tagName).catch(() => undefined);
          }
        }, 60_000);
      });
    });

    describe("tag delete", () => {
      describe("when deleting with --force", () => {
        it("deletes the tag without confirmation", async () => {
          const tagName = createUniqueTagName();
          await langwatch.prompts.tags.create({ name: tagName });

          const result = cli.run(`prompt tag delete ${tagName} --force`);

          expectCliResultSuccess(result);
          expect(result.output).toContain("Deleted tag:");

          const tags = await langwatch.prompts.tags.list();
          expect(tags.some((t: Tag) => t.name === tagName)).toBe(false);
        }, 60_000);
      });

      describe("when deleting with confirmation", () => {
        it("deletes the tag after typing the name", async () => {
          const tagName = createUniqueTagName();
          await langwatch.prompts.tags.create({ name: tagName });

          const result = await cli.runInteractive(
            `prompt tag delete ${tagName}`,
            [tagName],
          );

          expectCliResultSuccess(result);
          expect(result.output).toContain("Deleted tag:");

          const tags = await langwatch.prompts.tags.list();
          expect(tags.some((t: Tag) => t.name === tagName)).toBe(false);
        }, 60_000);
      });

      describe("when confirmation does not match", () => {
        it("aborts the deletion", async () => {
          const tagName = createUniqueTagName();
          await langwatch.prompts.tags.create({ name: tagName });

          try {
            const result = await cli.runInteractive(
              `prompt tag delete ${tagName}`,
              ["wrong-name"],
            );

            expect(result.success).toBe(true);
            expect(result.output).toContain("Aborted");

            const tags = await langwatch.prompts.tags.list();
            expect(tags.some((t: Tag) => t.name === tagName)).toBe(true);
          } finally {
            await langwatch.prompts.tags.delete(tagName).catch(() => undefined);
          }
        }, 60_000);
      });
    });

    describe("pull --tag", () => {
      describe("when pulling by tag", () => {
        it("fetches the tagged version instead of latest", async () => {
          const handle = createUniquePromptName();
          const tagName = createUniqueTagName();

          const v1 = await langwatch.prompts.create({
            handle,
            prompt: "Version 1",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2",
            commitMessage: "v2",
          });
          await langwatch.prompts.tags.create({ name: tagName });
          await langwatch.prompts.tags.assign(handle, {
            tag: tagName,
            versionId: v1.versionId ?? "",
          });

          try {
            const initResult = cli.run("prompt init");
            expectCliResultSuccess(initResult);

            const addResult = await cli.runInteractive(
              `prompt add ${handle}@latest`,
              ["y"],
            );
            expectCliResultSuccess(addResult);

            const pullResult = cli.run(`prompt pull --tag ${tagName}`);
            expectCliResultSuccess(pullResult);

            const materializedPromptFileManagement = new PromptFileManager({
              cwd: testDir,
              materializedDir: true,
            });
            const content =
              materializedPromptFileManagement.getPromptFileContent(handle);
            expect(content).toContain("Version 1");
            expect(content).not.toContain("Version 2");
          } finally {
            await langwatch.prompts.delete(handle).catch(() => undefined);
            await langwatch.prompts.tags.delete(tagName).catch(() => undefined);
          }
        }, 60_000);
      });
    });
  });
});
