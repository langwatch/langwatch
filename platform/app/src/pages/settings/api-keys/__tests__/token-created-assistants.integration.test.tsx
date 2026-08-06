/**
 * @vitest-environment jsdom
 *
 * The "Use with Code Assistants" section offered two tabs — Claude Code and
 * Codex — while the product documents the LangWatch MCP server for more
 * assistants than that, and the same file listed five *different* editors for
 * its config-path chips. A customer noticed the gap.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CODE_ASSISTANTS, TokenCreatedDialog } from "../TokenCreatedDialog";

function renderDialog() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TokenCreatedDialog
        newToken="sk-lw-test-token-value"
        projectId="project-abc"
        endpoint="https://app.langwatch.ai"
        orgProjects={[{ id: "project-abc", name: "ACME" }]}
        onClose={() => void 0}
      />
    </ChakraProvider>,
  );
}

describe("given a token has just been minted", () => {
  afterEach(cleanup);

  describe("when the Use with Code Assistants section renders", () => {
    /** @scenario Every supported coding assistant has a tab */
    it("offers a tab for every assistant the product supports", () => {
      renderDialog();

      const section = screen
        .getByText("Use with Code Assistants")
        .closest("div")!.parentElement!;

      for (const assistant of CODE_ASSISTANTS) {
        expect(
          within(section).getByRole("button", { name: assistant.label }),
        ).toBeTruthy();
      }
    });

    /** @scenario Every supported coding assistant has a tab */
    it("covers the assistants the customer called out as missing", () => {
      renderDialog();

      const labels = CODE_ASSISTANTS.map((assistant) => assistant.label);
      expect(labels).toEqual(
        expect.arrayContaining(["Claude Code", "Codex", "Cursor", "Gemini"]),
      );
    });
  });

  describe("when an assistant installs from the terminal", () => {
    /** @scenario An assistant with an install command shows a terminal snippet */
    it("builds that assistant's own command around the minted token", () => {
      const withCommand = CODE_ASSISTANTS.filter(
        (assistant) => assistant.buildCommand,
      );
      expect(withCommand.length).toBeGreaterThan(0);

      for (const assistant of withCommand) {
        const command = assistant.buildCommand!({
          apiKey: "sk-lw-real",
          projectId: "project-abc",
          endpoint: "https://app.langwatch.ai",
          isSelfHosted: false,
        });
        expect(command).toContain("sk-lw-real");
        expect(command).toContain("@langwatch/mcp-server");
      }
    });
  });

  describe("when an assistant has no terminal installer", () => {
    /** @scenario An assistant without an install command points at its config file */
    it("names the config file it reads instead", () => {
      const configOnly = CODE_ASSISTANTS.filter(
        (assistant) => !assistant.buildCommand,
      );
      expect(configOnly.length).toBeGreaterThan(0);

      for (const assistant of configOnly) {
        expect(assistant.configPath).toBeTruthy();
      }
    });
  });
});
