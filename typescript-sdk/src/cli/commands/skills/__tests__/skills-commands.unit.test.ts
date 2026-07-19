/**
 * The `langwatch skills …` command wrappers end to end against a temp install
 * root: list/get rendering, name validation, dry-run, the
 * install → update → uninstall round-trip, and non-interactive refusal.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findSkill,
  installSkill,
  MANAGED_MARKER,
  SKILLS_BUNDLE,
  type BundledSkill,
} from "../installer";
import { skillsListCommand } from "../list";
import { skillsGetCommand } from "../get";
import { skillsInstallCommand } from "../install";
import { skillsUpdateCommand } from "../update";
import { skillsUninstallCommand } from "../uninstall";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const skill = (slug: string): BundledSkill => {
  const found = findSkill(slug);
  if (!found) throw new Error(`test setup: no bundled skill ${slug}`);
  return found;
};

describe("the skills commands", () => {
  let root: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lw-skills-cmd-"));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const name of AGENT_MODE_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    for (const name of AGENT_MODE_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  const logged = (): string => consoleLogSpy.mock.calls.flat().join("\n");

  it("list reports the installed state at the target root", async () => {
    installSkill(skill("tracing"), root, {});
    await skillsListCommand({ dir: root, output: "json" });
    const parsed = JSON.parse(logged()) as {
      skills: { slug: string; installed: boolean }[];
    };
    const tracing = parsed.skills.find((row) => row.slug === "tracing")!;
    const prompts = parsed.skills.find((row) => row.slug === "prompts")!;
    expect(tracing.installed).toBe(true);
    expect(prompts.installed).toBe(false);
  });

  it("get prints the raw skill body, and structured data with -o json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await skillsGetCommand("tracing", {});
    const raw = stdoutSpy.mock.calls.flat().join("");
    expect(raw).toBe(skill("tracing").body);
    expect(raw.startsWith("---\nname: tracing")).toBe(true);

    await skillsGetCommand("recipes/setup-lw", { output: "json" });
    const parsed = JSON.parse(logged()) as { slug: string; body: string };
    expect(parsed.slug).toBe("recipes/setup-lw");
    expect(parsed.body).toContain("langwatch login");
  });

  it("get honors an explicit -o agents with compact single-line JSON", async () => {
    await skillsGetCommand("tracing", { output: "agents" });
    const out = logged();
    expect(out).not.toContain("\n");
    expect(JSON.parse(out)).toMatchObject({ slug: "tracing", name: "tracing" });
  });

  it("get rejects an unknown skill with a validation error", async () => {
    await expect(skillsGetCommand("nope", {})).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  it("install requires names or --all, and rejects unknown names", async () => {
    await expect(skillsInstallCommand([], { dir: root })).rejects.toMatchObject({
      code: "validation_error",
    });
    await expect(
      skillsInstallCommand(["nope"], { dir: root }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  it("install --all --dry-run reports every skill and writes nothing", async () => {
    await skillsInstallCommand([], { dir: root, all: true, dryRun: true, output: "json" });
    const parsed = JSON.parse(logged()) as {
      dryRun: boolean;
      results: { action: string }[];
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.results).toHaveLength(SKILLS_BUNDLE.length);
    expect(parsed.results.every((r) => r.action === "created")).toBe(true);
    expect(fs.existsSync(path.join(root, "skills"))).toBe(false);
  });

  it("install → update → uninstall round-trips through the commands", async () => {
    await skillsInstallCommand(["tracing"], { dir: root });
    const installed = path.join(root, "skills", "tracing", "SKILL.md");
    expect(fs.existsSync(installed)).toBe(true);

    // Make the installed file a stale-version managed install, so the update
    // command has something to refresh (byte-identical would be "unchanged").
    fs.writeFileSync(
      installed,
      `# old tracing skill\n\n<!-- managed-by: langwatch-skills v0.0.1 -->\n`,
      "utf8",
    );
    consoleLogSpy.mockClear();
    await skillsUpdateCommand(["tracing"], { dir: root, output: "json" });
    const updated = JSON.parse(logged()) as { results: { action: string }[] };
    expect(updated.results[0]!.action).toBe("updated");
    expect(fs.readFileSync(installed, "utf8")).toContain(MANAGED_MARKER);
    expect(fs.readFileSync(installed, "utf8")).not.toContain("old tracing skill");

    consoleLogSpy.mockClear();
    await skillsUninstallCommand(["tracing"], { dir: root, yes: true });
    expect(fs.existsSync(installed)).toBe(false);
  });

  it("uninstall refuses non-interactively without -y (never prompts an agent)", async () => {
    await skillsInstallCommand(["tracing"], { dir: root });
    // vitest's stdin has no TTY — the command must fail, not block.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(
      skillsUninstallCommand(["tracing"], { dir: root }),
    ).rejects.toMatchObject({
      code: "validation_error",
      message: expect.stringContaining("-y"),
    });
    expect(
      fs.existsSync(path.join(root, "skills", "tracing", "SKILL.md")),
    ).toBe(true);
  });

  it("uninstall --dry-run needs no confirmation and removes nothing", async () => {
    installSkill(skill("tracing"), root, {});
    await skillsUninstallCommand(["tracing"], { dir: root, dryRun: true, output: "json" });
    const parsed = JSON.parse(logged()) as { results: { action: string }[] };
    expect(parsed.results[0]!.action).toBe("removed");
    expect(
      fs.existsSync(path.join(root, "skills", "tracing", "SKILL.md")),
    ).toBe(true);
  });
});
