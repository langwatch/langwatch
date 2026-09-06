import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { z } from "zod";

/**
 * One transactional message, described well enough that a tool can render it
 * without knowing which message it is.
 *
 * The props are a zod schema rather than a TypeScript type because a type is
 * gone by the time anything could use it. The schema is what lets the preview
 * studio build a form for a message it has never heard of, and what makes a
 * fixture wrong at the moment it is written instead of at the moment it is
 * sent. Types come from the schema with `infer`; nothing here is declared
 * twice.
 */
export interface MailTemplate {
  /** Stable, url-safe, and the key the studio keeps in its address bar. */
  readonly id: string;
  /** What a person calls this message. */
  readonly title: string;
  /** When it is sent and to whom, in one sentence. */
  readonly sentWhen: string;
  readonly schema: z.ZodType;
  readonly fixtures: readonly MailFixture[];
  subject(props: unknown): string;
  element(props: unknown): ReactElement;
}

/** Realistic, plainly invented props — one worth looking at for this message. */
export interface MailFixture {
  readonly name: string;
  readonly props: unknown;
}

/**
 * Declares a template and erases its props type in the same step.
 *
 * The erasure is what lets one array hold every message. It costs nothing and
 * casts nothing: the erased `subject` and `element` take `unknown` honestly,
 * because they parse before they use, so props typed by hand in the studio go
 * through the same gate a fixture does.
 */
export const defineTemplate = <Schema extends z.ZodType>(spec: {
  id: string;
  title: string;
  sentWhen: string;
  schema: Schema;
  subject: (props: z.infer<Schema>) => string;
  Component: (props: z.infer<Schema>) => ReactElement;
  fixtures: Readonly<Record<string, z.infer<Schema>>>;
}): MailTemplate => ({
  id: spec.id,
  title: spec.title,
  sentWhen: spec.sentWhen,
  schema: spec.schema,
  fixtures: Object.entries(spec.fixtures).map(([name, props]) => ({ name, props })),
  subject: (props) => spec.subject(spec.schema.parse(props)),
  element: (props) => spec.Component(spec.schema.parse(props)),
});

/** Both bodies every message is sent with, from one pass over the props. */
export const renderMailTemplate = async (
  template: MailTemplate,
  props: unknown,
): Promise<{ subject: string; html: string; text: string }> => {
  const element = template.element(props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: template.subject(props), html, text };
};

/**
 * The props form the studio draws, as JSON Schema.
 *
 * Reading zod's own internals would tie the studio to a zod minor; JSON Schema
 * is the shape zod already agrees to export, and the one a form can walk
 * without a special case per version. A schema with no JSON Schema form is not
 * an error — the studio falls back to editing the props as JSON, which is
 * always available.
 */
export const propsFormSchema = (template: MailTemplate): unknown => {
  try {
    return z.toJSONSchema(template.schema, { io: "input", unrepresentable: "any" });
  } catch {
    return null;
  }
};
