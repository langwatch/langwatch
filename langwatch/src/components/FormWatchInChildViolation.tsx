// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect ast-grep `no-form-watch-in-child` to flag every `form.watch()` and
// `props.watch()` below. Tests both arrow-function and function-declaration
// shapes — the post-/review rule should match both.

import React from "react";
import type { UseFormReturn } from "react-hook-form";

type Form = UseFormReturn<{ name: string }>;

// Arrow-function child with destructured `form` prop.
export const ArrowChildViolation: React.FC<{ form: Form }> = ({ form }) => {
  const value = form.watch();
  return <div>{JSON.stringify(value)}</div>;
};

// Arrow-function child with bare-identifier param.
export const BareParamChild = (form: Form) => {
  const value = form.watch();
  return <div>{JSON.stringify(value)}</div>;
};

// function_declaration child.
export function FunctionDeclarationChildViolation(props: { form: Form }) {
  const value = props.form.watch();
  return <div>{JSON.stringify(value)}</div>;
}
