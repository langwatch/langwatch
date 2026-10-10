// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  OttlStatementsInvalidError,
  type OttlValidationError,
  type OttlValidationResult,
} from "@langwatch/enterprise-governance-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";

import { GovernanceOttlValidationClient } from "../../../model/governance-ottl-validation-client.ts";
import { OttlEditor } from "../ottl-editor.tsx";

const BROKEN = "set(attributes[ this is not ottl";
const PARSER_ERROR: OttlValidationError = {
  statementIndex: 1,
  line: 1,
  col: 15,
  message: 'statement has invalid syntax: 1:15: unexpected token "[" (expected ")" Key*)',
};

class FixedClient extends GovernanceOttlValidationClient {
  constructor(private readonly result: OttlValidationResult) {
    super();
  }
  async validate(): Promise<OttlValidationResult> {
    return this.result;
  }
}

function renderEditor({
  statements,
  result,
  refusal,
}: {
  statements: string[];
  result: OttlValidationResult;
  refusal?: unknown;
}) {
  return renderWithDesignSystem(
    <OttlEditor
      organizationId="org-1"
      sourceType="otel_generic"
      statements={statements}
      onChange={() => undefined}
      enabled
      validationClient={new FixedClient(result)}
      refusal={refusal}
    />,
  );
}

afterEach(cleanup);

describe("OttlEditor", () => {
  it("squiggles the parser's error range and says what it expected in plain words", async () => {
    renderEditor({
      statements: ['set(attributes["a"], 1)', BROKEN],
      result: { status: "invalid", errors: [PARSER_ERROR] },
    });

    const message = await screen.findByText(
      (_, el) => el?.tagName === "P" && el.textContent === "Expected ) after attributes, found [",
    );
    expect(message.querySelectorAll("code")).toHaveLength(3);
    const squiggle = document.querySelector("[data-ottl-error]");
    expect(squiggle?.textContent).toBe("[");
    expect(screen.getAllByRole("textbox")[1]).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/Key\*/)).not.toBeInTheDocument();
  });

  /** @scenario "Saving a source refuses OTTL the gateway parser rejects" */
  it("draws a refused save onto the statement it names, skipping blank lines", async () => {
    const refusal = new OttlStatementsInvalidError({
      statements: ['set(attributes["a"], 1)', BROKEN],
      errors: [PARSER_ERROR],
    }).serialize();

    renderEditor({
      statements: ['set(attributes["a"], 1)', "", BROKEN],
      result: { status: "deferred", reason: "gateway_unconfigured" },
      refusal,
    });

    await waitFor(() =>
      expect(screen.getAllByRole("textbox")[2]).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getAllByRole("textbox")[0]).not.toHaveAttribute("aria-invalid");
  });
});
