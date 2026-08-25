/**
 * Header state and play-button gating for prompt targets with unmapped
 * variables.
 *
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/test",
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

vi.mock("../../../hooks/useTargetName", () => {
  const useTargetName = (target: { id: string }) => target.id;
  return {
    useTargetName,
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});
vi.mock("../../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import { useEvaluationsV3Store } from "../../../hooks/useEvaluationsV3Store";
import { PromptTemplateFieldsContext } from "../../../hooks/usePromptTemplateFields";
import type { DatasetReference, TargetConfig } from "../../../types";
import { DEFAULT_TEST_DATA_ID } from "../../../types";
import { TargetHeader } from "../TargetHeader";

const TARGET_ID = "category_classifier";

/**
 * The reported shape: a prompt that declares the vestigial `input` every prompt
 * is born with, plus the variables its template actually references.
 */
const createClassifierTarget = ({
  messages,
  mappedFields,
  localPromptConfig = true,
}: {
  messages: Array<{ role: "system" | "user"; content: string }>;
  mappedFields: string[];
  localPromptConfig?: boolean;
}): TargetConfig => {
  const inputs = [
    { identifier: "input" as const, type: "str" as const },
    { identifier: "brand" as const, type: "str" as const },
    { identifier: "product_name" as const, type: "str" as const },
  ];

  const mappings: TargetConfig["mappings"] = { [DEFAULT_TEST_DATA_ID]: {} };
  for (const field of mappedFields) {
    mappings[DEFAULT_TEST_DATA_ID]![field] = {
      type: "source",
      source: "dataset",
      sourceId: DEFAULT_TEST_DATA_ID,
      sourceField: "input",
    };
  }

  return {
    id: TARGET_ID,
    type: "prompt",
    promptId: "prompt-classifier",
    inputs,
    outputs: [{ identifier: "output", type: "str" }],
    mappings,
    ...(localPromptConfig
      ? {
          localPromptConfig: {
            llm: { model: "gpt-5-mini" },
            messages,
            inputs,
            outputs: [{ identifier: "output" as const, type: "str" as const }],
          },
        }
      : {}),
  };
};

const createTestDataset = (): DatasetReference => ({
  id: DEFAULT_TEST_DATA_ID,
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
});

const renderHeader = (
  target: TargetConfig,
  {
    onRun,
    onEdit,
    templateFields,
  }: {
    onRun: () => void;
    onEdit: () => void;
    templateFields?: Record<string, string[]>;
  },
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <PromptTemplateFieldsContext.Provider
        value={
          templateFields
            ? (lookedUp) => {
                const fields = templateFields[lookedUp.id];
                return fields ? new Set(fields) : undefined;
              }
            : undefined
        }
      >
        <TargetHeader
          target={target}
          onRun={onRun}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      </PromptTemplateFieldsContext.Provider>
    </ChakraProvider>,
  );

beforeEach(() => {
  act(() => {
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().addDataset(createTestDataset());
  });
});

afterEach(() => {
  act(() => {
    useEvaluationsV3Store.getState().reset();
  });
  cleanup();
});

describe("TargetHeader missing mappings", () => {
  describe("given a template that never references a declared variable", () => {
    const target = () =>
      createClassifierTarget({
        messages: [
          { role: "system", content: "You classify products." },
          {
            role: "user",
            content: "Classify {{brand}} {{product_name}}",
          },
        ],
        mappedFields: ["brand", "product_name"],
      });

    /** @scenario "The column header stays quiet for a declared input the template does not use" */
    it("keeps the alert icon off the header", () => {
      renderHeader(target(), { onRun: vi.fn(), onEdit: vi.fn() });

      expect(
        screen.queryByTestId("missing-mapping-alert"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The column header stays quiet for a declared input the template does not use" */
    it("runs the target from the play button", async () => {
      const onRun = vi.fn();
      const onEdit = vi.fn();
      renderHeader(target(), { onRun, onEdit });

      await userEvent.click(screen.getByTestId("target-play-button"));

      expect(onRun).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe("given a template that references an unmapped variable", () => {
    const target = () =>
      createClassifierTarget({
        messages: [
          { role: "user", content: "Classify {{brand}} {{product_name}}" },
        ],
        mappedFields: ["brand"],
      });

    /** @scenario "The column header warns for a referenced variable that is unmapped" */
    it("shows the alert icon on the header", () => {
      renderHeader(target(), { onRun: vi.fn(), onEdit: vi.fn() });

      expect(screen.getByTestId("missing-mapping-alert")).toBeInTheDocument();
    });

    /** @scenario "The column header warns for a referenced variable that is unmapped" */
    it("opens the editor from the play button instead of running", async () => {
      const onRun = vi.fn();
      const onEdit = vi.fn();
      renderHeader(target(), { onRun, onEdit });

      await userEvent.click(screen.getByTestId("target-play-button"));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onRun).not.toHaveBeenCalled();
    });
  });

  describe("given a target with no draft and a resolved template", () => {
    const undraftedTarget = () =>
      createClassifierTarget({
        messages: [],
        mappedFields: ["brand", "product_name"],
        localPromptConfig: false,
      });

    it("keeps the alert icon off when the template skips the declared variable", () => {
      renderHeader(undraftedTarget(), {
        onRun: vi.fn(),
        onEdit: vi.fn(),
        templateFields: { [TARGET_ID]: ["brand", "product_name"] },
      });

      expect(
        screen.queryByTestId("missing-mapping-alert"),
      ).not.toBeInTheDocument();
    });

    it("shows the alert icon when the template needs the unmapped variable", () => {
      renderHeader(undraftedTarget(), {
        onRun: vi.fn(),
        onEdit: vi.fn(),
        templateFields: { [TARGET_ID]: ["brand", "product_name", "input"] },
      });

      expect(screen.getByTestId("missing-mapping-alert")).toBeInTheDocument();
    });
  });

  describe("given a target with no draft and no resolved template", () => {
    it("keeps the alert icon off and runs the target", async () => {
      const onRun = vi.fn();
      const onEdit = vi.fn();
      renderHeader(
        createClassifierTarget({
          messages: [],
          mappedFields: [],
          localPromptConfig: false,
        }),
        { onRun, onEdit },
      );

      expect(
        screen.queryByTestId("missing-mapping-alert"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId("target-play-button"));

      expect(onRun).toHaveBeenCalledTimes(1);
    });
  });
});
