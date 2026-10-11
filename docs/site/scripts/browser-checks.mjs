import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function tracingPrompt({ outDir }) {
  const markdown = await readFile(path.join(outDir, "skills/directory.md"), "utf8");
  const prompt = markdown.match(/````text\n([\s\S]*?)\n````/)?.[1];
  assert.ok(prompt, "The authored tracing prompt must exist");
  return prompt;
}

export async function checkAgentSetup({ page, base, prompt }) {
  await page.goto(`${base}introduction`);
  const video = page.locator("video");
  const quickStart = page.getByRole("heading", { name: /^Quick Start/ });
  assert.ok((await video.boundingBox()).y < (await quickStart.boundingBox()).y);
  assert.equal(await video.evaluate((element) => element.paused), true);
  const setup = page.locator(".docs-agent-start");
  for (const agent of ["Claude Code", "Codex", "Cursor"]) {
    const button = setup.getByRole("button", { name: agent, exact: true });
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.equal(await setup.locator('[aria-pressed="true"]').count(), 1);
    assert.ok((await setup.textContent()).includes(`Open your project in ${agent}`));
  }
  await setup.getByRole("button", { name: "Copy setup prompt" }).click();
  await setup.getByRole("button", { name: "Prompt copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
}

export async function checkSkillCopy({ page, base, prompt }) {
  await page.goto(`${base}skills/directory`);
  const card = page.locator(".docs-skill-card").first();
  await card.getByRole("button", { name: "Copy full prompt", exact: true }).click();
  await card.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
}

export async function checkMobileNavigation({ page, base }) {
  await page.goto(`${base}introduction`);
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Documentation" });
  await drawer.waitFor({ state: "visible" });
  assert.ok(await drawer.getByRole("link", { name: "API Reference", exact: true }).isVisible());
  const tree = drawer.getByRole("navigation", { name: "Page navigation" });
  assert.equal(await tree.locator('[aria-current="page"]').textContent(), "Introduction");
  const lastPage = tree.locator("a:visible").last();
  await lastPage.scrollIntoViewIfNeeded();
  const bounds = await lastPage.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
  await lastPage.click({ trial: true });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
}

export async function checkCapabilityErrors({ page, base }) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async () => {
        throw new DOMException("Clipboard access denied", "NotAllowedError");
      },
    });
  });
  await page.route("**/media/videos/introduction.webm", (route) => route.abort());
  await page.goto(`${base}introduction`);
  await page.getByRole("button", { name: "Watch the product tour" }).click();
  await page.getByRole("alert").filter({ hasText: "The video could not load" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Watch the product tour" }).isVisible());
  await page.unroute("**/media/videos/introduction.webm");
  await page.getByRole("button", { name: "Watch the product tour" }).click();
  await page.waitForFunction(() => document.querySelector("video").currentTime > 0);
  await page.getByRole("button", { name: "Copy setup prompt" }).click();
  await page.getByText("Copy failed. Open the skills directory").waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Explore all skills" }).getAttribute("href"),
    "/skills/directory",
  );
}

export async function checkStaticDiagrams({ browser, base }) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${base}langy/how-langy-works`);
    assert.ok((await page.locator(".docs-mermaid .docs-light-only svg").count()) > 0);
    assert.ok((await page.locator(".docs-mermaid .docs-dark-only svg").count()) > 0);
    const diagram = page.getByRole("figure", { name: /Diagram/ }).first();
    await diagram.locator("summary").click();
    assert.ok(await diagram.locator("pre").isVisible());
    assert.match(await diagram.locator("pre").textContent(), /graph|flowchart|sequenceDiagram/);
  } finally {
    await context.close();
  }
}
