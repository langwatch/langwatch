/**
 * The saved-template lookup the workbench publishes to mapping validation.
 *
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

type PromptQueryResult = {
  data:
    | {
        version: number;
        versionId: string;
        messages: Array<{ role: string; content: string }>;
      }
    | undefined;
};

const promptQueryResults = new Map<string, PromptQueryResult>();
/** Every input the provider asked a prompt query with, in order. */
const promptQueryInputs: Array<{
  idOrHandle: string;
  versionId?: string;
  version?: number;
}> = [];

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: (
      build: (t: {
        prompts: {
          getByIdOrHandle: (
            input: {
              idOrHandle: string;
              projectId: string;
              versionId?: string;
              version?: number;
            },
            options: unknown,
          ) => PromptQueryResult;
        };
      }) => PromptQueryResult[],
    ) =>
      build({
        prompts: {
          getByIdOrHandle: (input) => {
            promptQueryInputs.push(input);
            return (
              promptQueryResults.get(input.idOrHandle) ?? { data: undefined }
            );
          },
        },
      }),
  },
}));

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { usePromptTemplateFields } from "../../hooks/usePromptTemplateFields";
import type { TargetConfig } from "../../types";
import { PromptTemplateFieldsProvider } from "../PromptTemplateFieldsProvider";

const TARGET_ID = "target-classifier";

const ResolvedFields = ({ target }: { target: TargetConfig }) => {
  const promptTemplateFields = usePromptTemplateFields();
  const fields = promptTemplateFields?.(target);
  return (
    <div data-testid="resolved">
      {fields ? [...fields].sort().join(",") : "unresolved"}
    </div>
  );
};

const createTarget = (promptVersionNumber?: number): TargetConfig => ({
  id: TARGET_ID,
  type: "prompt",
  promptId: "prompt-classifier",
  ...(promptVersionNumber === undefined ? {} : { promptVersionNumber }),
  inputs: [
    { identifier: "input", type: "str" },
    { identifier: "product_name", type: "str" },
  ],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
});

const renderProvider = (target: TargetConfig) => {
  act(() => {
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().addTarget(target);
  });

  return render(
    <PromptTemplateFieldsProvider>
      <ResolvedFields target={target} />
    </PromptTemplateFieldsProvider>,
  );
};

const createIdPinnedTarget = (promptVersionId: string): TargetConfig => ({
  ...createTarget(),
  promptVersionId,
});

beforeEach(() => {
  promptQueryResults.clear();
  promptQueryInputs.length = 0;
});

afterEach(() => {
  act(() => {
    useEvaluationsV3Store.getState().reset();
  });
  cleanup();
});

describe("PromptTemplateFieldsProvider", () => {
  describe("given the target follows the loaded version", () => {
    it("resolves the variables the template references", () => {
      promptQueryResults.set("prompt-classifier", {
        data: {
          version: 4,
          versionId: "version-4",
          messages: [
            { role: "system", content: "You classify products." },
            { role: "user", content: "Classify {{product_name}}" },
          ],
        },
      });

      renderProvider(createTarget(4));

      expect(screen.getByTestId("resolved").textContent).toBe("product_name");
    });
  });

  describe("given the target is pinned to another version", () => {
    it("resolves nothing, because that template was not loaded", () => {
      promptQueryResults.set("prompt-classifier", {
        data: {
          version: 7,
          versionId: "version-7",
          messages: [{ role: "user", content: "Classify {{product_name}}" }],
        },
      });

      renderProvider(createTarget(3));

      expect(screen.getByTestId("resolved").textContent).toBe("unresolved");
    });
  });

  describe("given the target is pinned by version id and names no number", () => {
    it("asks for that version, so the mapping describes the template that runs", () => {
      promptQueryResults.set("prompt-classifier", {
        data: {
          version: 3,
          versionId: "version-3",
          messages: [{ role: "user", content: "Classify {{product_name}}" }],
        },
      });

      renderProvider(createIdPinnedTarget("version-3"));

      expect(promptQueryInputs[0]?.versionId).toBe("version-3");
      expect(screen.getByTestId("resolved").textContent).toBe("product_name");
    });
  });

  describe("given the answer is a different version than the id pin", () => {
    it("resolves nothing, rather than describing the column from the latest", () => {
      promptQueryResults.set("prompt-classifier", {
        data: {
          version: 9,
          versionId: "version-9",
          messages: [{ role: "user", content: "Classify {{sku}}" }],
        },
      });

      renderProvider(createIdPinnedTarget("version-3"));

      expect(screen.getByTestId("resolved").textContent).toBe("unresolved");
    });
  });

  describe("given the prompt has not loaded", () => {
    it("resolves nothing", () => {
      renderProvider(createTarget(4));

      expect(screen.getByTestId("resolved").textContent).toBe("unresolved");
    });
  });

  describe("given a template with no user or assistant message", () => {
    it("resolves every declared variable", () => {
      promptQueryResults.set("prompt-classifier", {
        data: {
          version: 4,
          versionId: "version-4",
          messages: [{ role: "system", content: "You classify products." }],
        },
      });

      renderProvider(createTarget(4));

      expect(screen.getByTestId("resolved").textContent).toBe(
        "input,product_name",
      );
    });
  });
});
