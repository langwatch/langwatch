import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod/v4";
import { DynamicZodFormBuilder } from "../DynamicZodFormBuilder";

function WithForm({ children }: { children: React.ReactNode }) {
  const methods = useForm();
  return <FormProvider {...methods}>{children}</FormProvider>;
}

function renderFormWith(schema: any, testIdPrefix = "") {
  const components = {
    string: <div data-testid={`${testIdPrefix}string`} />,
    number: <div data-testid={`${testIdPrefix}number`} />,
    boolean: <div data-testid={`${testIdPrefix}boolean`} />,
    object: <div data-testid={`${testIdPrefix}object`} />,
    array: <div data-testid={`${testIdPrefix}array`} />,
  } as const;

  render(
    <WithForm>
      <DynamicZodFormBuilder schema={schema} components={components as any} />
    </WithForm>,
  );
}

describe("DynamicZodFormBuilder", () => {
  it("renders mapped component per type and deduces field names from root-level object schema", () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
      published: z.boolean(),
      meta: z.object({ foo: z.string() }),
      tags: z.array(z.string()),
    });

    renderFormWith(schema, "input-");

    expect(screen.getByText("title")).toBeDefined();
    expect(screen.getByText("count")).toBeDefined();
    expect(screen.getByText("published")).toBeDefined();
    expect(screen.getByText("meta")).toBeDefined();
    expect(screen.getByText("tags")).toBeDefined();

    expect(screen.getAllByTestId("input-string")).toHaveLength(1);
    expect(screen.getAllByTestId("input-number")).toHaveLength(1);
    expect(screen.getAllByTestId("input-boolean")).toHaveLength(1);
    expect(screen.getAllByTestId("input-object")).toHaveLength(1);
    expect(screen.getAllByTestId("input-array")).toHaveLength(1);
  });

  it("renders correctly when schema itself is a ZodArray", () => {
    const arraySchema = z.array(z.object({ foo: z.string() }));

    renderFormWith(arraySchema, "array-input-");

    // Should render the "array" type component at root
    expect(screen.getByTestId("array-input-array")).toBeDefined();
  });

  it("renders correctly when schema itself is a ZodObject", () => {
    const objectSchema = z.object({
      bar: z.string(),
      nested: z.object({ baz: z.number() }),
    });

    renderFormWith(objectSchema, "root-object-");

    expect(screen.getByText("bar")).toBeDefined();
    expect(screen.getByText("nested")).toBeDefined();
    expect(screen.getAllByTestId("root-object-string")).toHaveLength(1);
    expect(screen.getAllByTestId("root-object-object")).toHaveLength(1);
  });
});
