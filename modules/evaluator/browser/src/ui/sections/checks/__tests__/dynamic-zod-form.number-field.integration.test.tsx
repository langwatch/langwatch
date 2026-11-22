// @vitest-environment jsdom

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { type FieldValues, FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "proj-1" } }),
}));

vi.mock("../../../../behavior/use-evaluator-default-models.ts", () => ({
  useEvaluatorDefaultModels: () => ({
    resolvedDefaultModel: { data: void 0 },
    resolvedDefaultEmbeddings: { data: void 0 },
  }),
}));

import DynamicZodForm from "../dynamic-zod-form.tsx";

afterEach(() => cleanup());

const schema = z.object({
  min_score: z.number().optional(),
  max_tokens_cap: z.number(),
});

function renderNumberFields() {
  const form: { current?: UseFormReturn } = {};
  const Harness = () => {
    const methods = useForm<FieldValues>({ defaultValues: { settings: {} } });
    form.current = methods;
    return (
      <FormProvider {...methods}>
        <DynamicZodForm
          schema={schema}
          evaluatorType="custom/unknown"
          prefix="settings"
          errors={void 0}
        />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
  const inputs = screen.getAllByRole("spinbutton");
  return { form, optionalInput: inputs[0]!, requiredInput: inputs[1]! };
}

describe("DynamicZodForm number field", () => {
  describe("given an optional number setting", () => {
    it("reads a typed number as that number", () => {
      const { form, optionalInput } = renderNumberFields();

      fireEvent.change(optionalInput, { target: { value: "3" } });

      expect(form.current!.getValues("settings.min_score")).toBe(3);
    });

    it("leaves the setting unset when the input is cleared", () => {
      const { form, optionalInput } = renderNumberFields();

      fireEvent.change(optionalInput, { target: { value: "3" } });
      fireEvent.change(optionalInput, { target: { value: "" } });

      expect(form.current!.getValues("settings.min_score")).toBeUndefined();
    });
  });

  describe("given a required number setting", () => {
    it("keeps reading a cleared input as 0", () => {
      const { form, requiredInput } = renderNumberFields();

      fireEvent.change(requiredInput, { target: { value: "5" } });
      fireEvent.change(requiredInput, { target: { value: "" } });

      expect(form.current!.getValues("settings.max_tokens_cap")).toBe(0);
    });
  });
});
