/**
 * @vitest-environment jsdom
 * The HTTP agent editor's tabs, held on their own strip until the colour proof lands: arrow keys
 * move focus, every panel stays mounted so a half-typed field survives, and Variables is optional.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentHttpEditorTabs } from "../ui/sections/agent-http-editor-tabs.tsx";

function Harness({ showVariablesTab = false }: { showVariablesTab?: boolean }) {
  const [activeTab, setActiveTab] = useState("body");
  const [sessionPath, setSessionPath] = useState("");
  return (
    <AgentHttpEditorTabs
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      showVariablesTab={showVariablesTab}
      bodyTemplate="{}"
      onBodyTemplateChange={() => void 0}
      outputPath=""
      onOutputPathChange={() => void 0}
      sessionPath={sessionPath}
      onSessionPathChange={setSessionPath}
      variables={[]}
      scenarioMappings={{}}
      onScenarioMappingChange={() => void 0}
      auth={void 0}
      onAuthChange={() => void 0}
      headers={[]}
      onHeadersChange={() => void 0}
      method="POST"
      url="https://example.com/agent"
      localMappings={{}}
      onVariablesChange={() => void 0}
      onMappingChange={() => void 0}
      missingMappingIds={new Set()}
      fixedVariableIds={new Set()}
      hasAtLeastOneMapping
      onTest={async () => ({ success: true })}
      renderScenarioMappings={() => null}
      renderVariables={() => <p>variables editor</p>}
      explainTestError={() => ({ title: "Request failed" })}
      hooks={{
        hooksUrl: "",
        onHooksUrlChange: () => void 0,
        hooks: { setup: true, teardown: true },
        onHooksChange: () => void 0,
        newSigningSecret: null,
        hasStoredSigningSecret: false,
        onRotateSigningSecret: () => void 0,
        moveNotice: null,
        previousSigningSecretValidUntil: null,
      }}
    />
  );
}

describe("the HTTP agent editor tabs", () => {
  afterEach(cleanup);

  describe("given the Body tab is selected", () => {
    it("moves focus to the next tab with the arrow key", async () => {
      renderWithDesignSystem(<Harness />);
      const user = userEvent.setup();

      screen.getByRole("tab", { name: "Body" }).focus();
      await user.keyboard("{ArrowRight}");

      expect(screen.getByRole("tab", { name: "Auth" })).toHaveFocus();
    });

    it("keeps a half-typed session path when the reader leaves the tab and returns", async () => {
      renderWithDesignSystem(<Harness />);
      const user = userEvent.setup();

      const field = screen.getByPlaceholderText("$.conversation_id");
      await user.type(field, "$.thread");
      await user.click(screen.getByRole("tab", { name: "Headers" }));
      await user.click(screen.getByRole("tab", { name: "Body" }));

      await waitFor(() => expect(screen.getByPlaceholderText("$.conversation_id")).toBe(field));
      expect(field).toHaveValue("$.thread");
    });

    it("offers Variables only when the caller says there are variables", () => {
      const { rerender } = renderWithDesignSystem(<Harness />);
      expect(screen.queryByRole("tab", { name: "Variables" })).not.toBeInTheDocument();

      rerender(<Harness showVariablesTab />);

      expect(screen.getByRole("tab", { name: "Variables" })).toBeInTheDocument();
    });
  });
});
