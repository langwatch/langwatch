/* @vitest-environment jsdom */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpConfigEditor, type HttpConfigEditorProps } from "../http-config-editor.tsx";

const REFERENCE = "{{ secrets.HTTP_AGENT_TOKEN }}";

function Harness({ readOnly, spy }: { readOnly: boolean; spy: (next: unknown) => void }) {
  const [auth, setAuth] = useState<HttpConfigEditorProps["auth"]>({
    type: "bearer",
    token: REFERENCE,
  });
  const [headers, setHeaders] = useState([
    { key: "Authorization", value: "Bearer {{ secrets.HTTP_AGENT_AUTHORIZATION }}" },
  ]);
  return (
    <HttpConfigEditor
      url="https://agent.example.com"
      onUrlChange={vi.fn()}
      method="POST"
      onMethodChange={vi.fn()}
      bodyTemplate="{}"
      onBodyTemplateChange={vi.fn()}
      outputPath="$.output"
      onOutputPathChange={vi.fn()}
      auth={auth}
      onAuthChange={(next) => {
        spy(next);
        setAuth(next);
      }}
      headers={headers}
      onHeadersChange={setHeaders}
      onTest={vi.fn()}
      credentialsReadOnly={readOnly}
    />
  );
}

function renderEditor({ readOnly = false }: { readOnly?: boolean } = {}) {
  const spy = vi.fn();
  renderWithDesignSystem(<Harness readOnly={readOnly} spy={spy} />);
  return spy;
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

describe("the HTTP config editor with credentials kept as project secrets", () => {
  describe("when the token and a header value are references", () => {
    /** @scenario "A credential kept as a project secret shows as a reference" */
    it("names each secret, links to the Secrets page and shows no input for it", async () => {
      renderEditor();

      openTab("Auth");
      expect(await screen.findByText("Stored as project secret HTTP_AGENT_TOKEN")).toBeVisible();
      expect((await openPanel("Auth")).getByTestId("secret-reference-link")).toHaveAttribute(
        "href",
        "/settings/secrets",
      );
      expect(screen.queryByPlaceholderText("Enter bearer token")).toBeNull();

      openTab("Headers");
      expect(
        await screen.findByText("Stored as project secret HTTP_AGENT_AUTHORIZATION"),
      ).toBeVisible();
      expect(screen.queryByTestId("header-value-0")).toBeNull();
    });

    /** @scenario "Looking at a secret reference changes nothing on the node" */
    it("leaves the credential untouched until Replace is chosen", async () => {
      const onAuthChange = renderEditor();

      openTab("Auth");
      await screen.findByText("Stored as project secret HTTP_AGENT_TOKEN");
      openTab("Headers");
      openTab("Auth");

      expect(onAuthChange).not.toHaveBeenCalled();
    });
  });

  describe("when Replace is chosen on the token", () => {
    /** @scenario "Replacing a stored credential offers an empty input" */
    it("shows an empty input that takes a new value", async () => {
      const onAuthChange = renderEditor();
      openTab("Auth");

      fireEvent.click(await (await openPanel("Auth")).findByTestId("secret-reference-replace"));
      const input = await screen.findByPlaceholderText("Enter bearer token");
      expect(input).toHaveValue("");

      fireEvent.change(input, { target: { value: "new-token" } });

      expect(onAuthChange).toHaveBeenLastCalledWith({ type: "bearer", token: "new-token" });
    });
  });

  describe("when a saved agent's credentials are read-only", () => {
    /** @scenario "A saved agent's secret reference is read-only on the Studio node" */
    it("names the secret and offers no Replace", async () => {
      renderEditor({ readOnly: true });
      openTab("Auth");

      expect(await screen.findByText("Stored as project secret HTTP_AGENT_TOKEN")).toBeVisible();
      expect(screen.queryByTestId("secret-reference-replace")).toBeNull();

      openTab("Headers");
      await screen.findByText("Stored as project secret HTTP_AGENT_AUTHORIZATION");
      expect(screen.queryByTestId("secret-reference-replace")).toBeNull();
    });
  });
});
