/* @vitest-environment jsdom */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpConfigEditor } from "../http-config-editor.tsx";

function renderEditor() {
  return renderWithDesignSystem(
    <HttpConfigEditor
      url="https://agent.example.com"
      onUrlChange={vi.fn()}
      method="POST"
      onMethodChange={vi.fn()}
      bodyTemplate="{}"
      onBodyTemplateChange={vi.fn()}
      outputPath="$.output"
      onOutputPathChange={vi.fn()}
      auth={{ type: "bearer", token: "" }}
      onAuthChange={vi.fn()}
      headers={[{ key: "X-Api-Key", value: "" }]}
      onHeadersChange={vi.fn()}
      onTest={vi.fn()}
      credentialsReadOnly
    />,
  );
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
  fireEvent.click(screen.getByRole("tab", { name }));
}

// Every tab panel stays mounted (hidden) as on main; query the open one only.
async function openPanel(name: string) {
  return within(await screen.findByRole("tabpanel", { name }));
}

afterEach(() => cleanup());

describe("the HTTP config editor with the credentials read-only", () => {
  describe("when a saved agent's auth is on show", () => {
    /** @scenario "A saved agent's credentials are read-only on the Studio node" */
    it("says the token is stored on the agent and locks it", async () => {
      renderEditor();
      openTab("Auth");

      const field = await (await openPanel("Auth")).findByPlaceholderText("Stored on the agent");

      expect(field).toBeDisabled();
    });
  });

  describe("when a saved agent's headers are on show", () => {
    /** @scenario "A saved agent's credentials are read-only on the Studio node" */
    it("says the header value is stored on the agent and offers no way to change the list", async () => {
      renderEditor();
      openTab("Headers");

      const field = await (await openPanel("Headers")).findByPlaceholderText("Stored on the agent");

      expect(field).toBeDisabled();
      expect(screen.queryByTestId("add-header-button")).toBeNull();
    });
  });
});
