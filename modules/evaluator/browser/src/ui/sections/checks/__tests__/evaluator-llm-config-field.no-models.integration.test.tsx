// @vitest-environment jsdom

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: (name: string) => ({
    enabled: name === "release_instant_evals" && flag.enabled,
    isLoading: false,
  }),
}));

// The project has no enabled model provider.
vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  LLMModelDisplay: () => <span>model display</span>,
}));

vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  LLMConfigPopover: () => null,
}));

import { EvaluatorLLMConfigField } from "../evaluator-llm-config-field.tsx";

beforeEach(() => {
  flag.enabled = false;
});
afterEach(() => cleanup());

function renderField() {
  const Harness = () => {
    const methods = useForm({ defaultValues: { settings: {} } });
    return (
      <FormProvider {...methods}>
        <EvaluatorLLMConfigField prefix="settings" />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
}

describe("EvaluatorLLMConfigField", () => {
  describe("given a project with no model provider", () => {
    describe("when Instant Evals is not released", () => {
      it("shows that no models are configured", () => {
        renderField();

        expect(screen.queryByText(/No models configured/i)).not.toBeNull();
        expect(screen.queryByText("model display")).toBeNull();
      });
    });

    describe("when Instant Evals is released", () => {
      it("still shows the model picker, so Instant Evals can be picked", () => {
        flag.enabled = true;
        renderField();

        expect(screen.queryByText(/No models configured/i)).toBeNull();
        expect(screen.queryByText("model display")).not.toBeNull();
      });
    });
  });
});
