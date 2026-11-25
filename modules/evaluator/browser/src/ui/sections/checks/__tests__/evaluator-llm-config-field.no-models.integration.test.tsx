// @vitest-environment jsdom
/**
 * The judges Instant Evals answers are offered LangWatch's model where the server releases it,
 * named by the router flag, and own decision models either way. The stand-in lists what it gets.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";
import { findSelectedOptions } from "@langwatch/model-provider-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWN_DECISION_MODEL = {
  value: "openai/decisions:gpt-6-luna",
  label: "gpt-6-luna",
};
const HOSTED_DECISION_MODEL = {
  value: "langwatch/instant-preview",
  label: "LangWatch Instant (preview)",
};

const state = vi.hoisted(() => ({
  flagReleased: false,
  judgeRouted: false,
  routerLoading: false,
  released: false,
  providers: [] as unknown[],
  decisionModels: [] as { value: string; label: string }[],
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

// Read at render time, after the constant's import has resolved.
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: ({ name }: { name: string }) => ({
    enabled:
      (name === INSTANT_EVALS_FLAG && state.flagReleased) ||
      (name === "release_instant_evals_judge_router" && state.judgeRouted),
    isLoading: name === "release_instant_evals_judge_router" && state.routerLoading,
  }),
}));

vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: state.providers, isLoading: false }),
      },
      listDecisionModelsForProject: {
        useQuery: () => ({ data: state.decisionModels, isLoading: false }),
      },
    },
    instantEval: {
      access: {
        useQuery: () => ({
          data: { released: state.released, hostedReleased: state.released, offer: "enable" },
          isLoading: false,
        }),
      },
    },
  },
}));

// The display's own lookup, so a name read here is the name the real display shows.
vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  LLMModelDisplay: ({
    model,
    builtInModels,
  }: {
    model: string;
    builtInModels?: { value: string; label: string }[];
  }) => (
    <span data-testid="model display" data-model={model}>
      {findSelectedOptions({ options: builtInModels ?? [], model })[0]?.label ?? "Update needed"}
    </span>
  ),
}));

// Lists what it is handed, and edits a parameter the way the real popover does: every key back.
vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  LLMConfigPopover: ({
    builtInModels,
    values,
    onChange,
  }: {
    builtInModels?: { label: string }[];
    values: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
  }) => (
    <>
      <ul aria-label="model options">
        {builtInModels?.map((model) => (
          <li key={model.label}>{model.label}</li>
        ))}
      </ul>
      <button type="button" onClick={() => onChange({ ...values, temperature: 0.3 })}>
        change temperature
      </button>
    </>
  ),
}));

import { EvaluatorLLMConfigField } from "../evaluator-llm-config-field.tsx";

const CONFIGURED_PROVIDER = { provider: "openai", enabled: true, customModels: null };

beforeEach(() => {
  state.flagReleased = false;
  state.judgeRouted = false;
  state.routerLoading = false;
  state.released = false;
  state.providers = [];
  state.decisionModels = [];
});
afterEach(() => cleanup());

function renderField({
  model,
  evaluatorType = "langevals/llm_boolean",
}: { model?: string; evaluatorType?: string } = {}) {
  const FormModel = () => (
    <output aria-label="form model">{useWatch({ name: "settings.model" })}</output>
  );
  const Harness = () => {
    const methods = useForm({ defaultValues: { settings: model ? { model } : {} } });
    return (
      <FormProvider {...methods}>
        <EvaluatorLLMConfigField prefix="settings" evaluatorType={evaluatorType} />
        <FormModel />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
}

function shownModel(): string | null {
  return screen.getByTestId("model display").getAttribute("data-model");
}

function shownName(): string {
  return screen.getByTestId("model display").textContent ?? "";
}

function offersInstantEvals(): boolean {
  return offeredLabels().includes("LangWatch Instant (preview)");
}

function offeredLabels(): string[] {
  return screen.queryAllByRole("listitem").map((option) => option.textContent ?? "");
}

describe("EvaluatorLLMConfigField", () => {
  it("reads the release flag by its shared name", () => {
    expect(INSTANT_EVALS_FLAG).toBe("release_instant_evals");
  });

  describe("given a project with a model provider", () => {
    beforeEach(() => {
      state.providers = [CONFIGURED_PROVIDER];
    });

    describe("when the server releases Instant Evals", () => {
      /** @scenario "The judge model picker shows Instant Evals when released" */
      it("offers Instant Evals among the picker's options", () => {
        state.released = true;
        renderField();

        expect(offersInstantEvals()).toBe(true);
      });
    });

    describe("when the server does not release Instant Evals", () => {
      /** @scenario "The judge model picker hides Instant Evals when not released" */
      it("does not offer Instant Evals", () => {
        renderField();

        expect(screen.queryByLabelText("model options")).not.toBeNull();
        expect(offersInstantEvals()).toBe(false);
      });
    });

    describe("when release_instant_evals is on but the server does not release Instant Evals", () => {
      /** @scenario "The release flag alone does not put Instant Evals in the picker" */
      it("does not offer Instant Evals", () => {
        state.flagReleased = true;
        renderField();

        expect(screen.queryByLabelText("model options")).not.toBeNull();
        expect(offersInstantEvals()).toBe(false);
      });
    });

    describe("when the server answers with Instant Evals and an own decision model", () => {
      beforeEach(() => {
        state.released = true;
        state.decisionModels = [HOSTED_DECISION_MODEL, OWN_DECISION_MODEL];
      });

      /** @scenario "The judge model picker offers the project's own decision models" */
      it("offers Instant Evals first, then the own decision model", () => {
        renderField();

        expect(offeredLabels()).toEqual(["LangWatch Instant (preview)", OWN_DECISION_MODEL.label]);
      });
    });

    describe("when the server answers with the hosted model only", () => {
      /** @scenario "The picker offers Instant Evals alone when the server offers no own model" */
      it("offers Instant Evals and nothing else", () => {
        state.released = true;
        state.decisionModels = [HOSTED_DECISION_MODEL];
        renderField();

        expect(offeredLabels()).toEqual(["LangWatch Instant (preview)"]);
      });
    });

    describe("when the server releases Instant Evals", () => {
      beforeEach(() => {
        state.released = true;
        state.decisionModels = [HOSTED_DECISION_MODEL];
      });

      /** @scenario "An LLM judge is offered one LangWatch model, named by the judge router flag" */
      it("offers only LangWatch Evals (preview), saved as langwatch/instant-evals, with the router flag on", () => {
        state.judgeRouted = true;
        renderField();

        expect(offeredLabels()).toEqual(["LangWatch Evals (preview)"]);
      });

      /** @scenario "An LLM judge is offered one LangWatch model, named by the judge router flag" */
      it("offers only LangWatch Instant (preview) with the router flag off", () => {
        renderField();

        expect(offeredLabels()).toEqual(["LangWatch Instant (preview)"]);
      });

      /** @scenario "A judge saved on the old id shows LangWatch Evals (preview) where routing is on" */
      it("shows a judge on langwatch/instant-evals as LangWatch Evals (preview) and leaves it stored", () => {
        state.judgeRouted = true;
        renderField({ model: "langwatch/instant-evals" });

        expect(shownName()).toBe("LangWatch Evals (preview)");
        expect(screen.getByLabelText("form model")).toHaveTextContent("langwatch/instant-evals");
      });

      /** @scenario "A judge stored with the earlier id shows as LangWatch Instant (preview) where routing is off" */
      it("shows a judge on langwatch/instant-evals as LangWatch Instant (preview) and leaves it stored", () => {
        renderField({ model: "langwatch/instant-evals" });

        expect(shownName()).toBe("LangWatch Instant (preview)");
        expect(screen.getByLabelText("form model")).toHaveTextContent("langwatch/instant-evals");
      });

      /** @scenario "A judge on the LangWatch Evals (preview) id shows as LangWatch Instant (preview) where routing is off" */
      it("shows a judge on langwatch/evals-preview as LangWatch Instant (preview), never Update needed", () => {
        renderField({ model: "langwatch/evals-preview" });

        expect(shownName()).toBe("LangWatch Instant (preview)");
        expect(screen.getByLabelText("form model")).toHaveTextContent("langwatch/evals-preview");
      });

      /** @scenario "A judge on the LangWatch Instant (preview) id keeps its name where routing is on" */
      it("shows a judge on langwatch/instant-preview as LangWatch Instant (preview) with the router flag on", () => {
        state.judgeRouted = true;
        renderField({ model: "langwatch/instant-preview" });

        expect(shownModel()).toBe("langwatch/instant-preview");
        expect(shownName()).toBe("LangWatch Instant (preview)");
      });

      /** @scenario "Editing a judge's parameters keeps its stored model id" */
      it.each([
        ["langwatch/instant-evals", true],
        ["langwatch/instant-evals", false],
        ["langwatch/evals-preview", true],
        ["langwatch/evals-preview", false],
        ["langwatch/instant-preview", true],
        ["langwatch/instant-preview", false],
      ])(
        "keeps a judge stored as %s when a parameter changes (router flag on: %s)",
        (model, isRouted) => {
          state.judgeRouted = isRouted;
          renderField({ model });

          fireEvent.click(screen.getByRole("button", { name: "change temperature" }));

          expect(screen.getByLabelText("form model")).toHaveTextContent(model);
        },
      );

      /** @scenario "A judge on the LangWatch Instant (preview) id keeps its name where routing is on" */
      it("lists LangWatch Instant (preview) in the open picker for a judge that holds its id, router flag on", () => {
        state.judgeRouted = true;
        renderField({ model: "langwatch/instant-preview" });

        expect(offeredLabels()).toEqual([
          "LangWatch Evals (preview)",
          "LangWatch Instant (preview)",
        ]);
      });

      it("lists only LangWatch Evals (preview) in the open picker for any other judge, router flag on", () => {
        state.judgeRouted = true;
        renderField({ model: "langwatch/instant-evals" });

        expect(offeredLabels()).toEqual(["LangWatch Evals (preview)"]);
      });

      /** @scenario "The judge picker waits for the judge router flag before naming a model" */
      it("shows a placeholder while the router flag loads", () => {
        state.routerLoading = true;
        renderField({ model: "langwatch/evals-preview" });

        expect(screen.queryByTestId("model display")).toBeNull();
        expect(screen.queryByText("Update needed")).toBeNull();
      });

      /** @scenario "An evaluator Instant Evals does not answer is offered no decision model" */
      it("offers an Off Topic evaluator no LangWatch or own decision model", () => {
        state.decisionModels = [HOSTED_DECISION_MODEL, OWN_DECISION_MODEL];
        renderField({ evaluatorType: "langevals/off_topic" });

        expect(offeredLabels()).toEqual([]);
      });
    });

    describe("when the server does not release Instant Evals but answers with an own model", () => {
      /** @scenario "The picker offers own decision models when Instant Evals are not released" */
      it("offers the own decision model but not Instant Evals", () => {
        state.decisionModels = [HOSTED_DECISION_MODEL, OWN_DECISION_MODEL];
        renderField();

        expect(offeredLabels()).toEqual([OWN_DECISION_MODEL.label]);
      });
    });
  });

  describe("given a project with no model provider", () => {
    describe("when Instant Evals is not released", () => {
      it("shows that no models are configured", () => {
        renderField();

        expect(screen.queryByText(/No models configured/i)).not.toBeNull();
        expect(screen.queryByTestId("model display")).toBeNull();
      });
    });

    describe("when the server releases Instant Evals", () => {
      /** @scenario "A project with no model provider can still pick Instant Evals" */
      it("keeps the picker and offers Instant Evals", () => {
        state.released = true;
        renderField();

        expect(screen.queryByText(/No models configured/i)).toBeNull();
        expect(offersInstantEvals()).toBe(true);
      });
    });
  });
});
