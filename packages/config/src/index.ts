import { z } from "zod";

export const nodeEnvironmentSchema = z.enum([
  "development",
  "test",
  "production",
]);

export const environmentBooleanSchema = z
  .union([
    z.boolean(),
    z.literal("true"),
    z.literal("false"),
    z.literal("1"),
    z.literal("0"),
  ])
  .transform(
    (value) => value === true || value === "true" || value === "1",
  );

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const nonNegativeSecondsSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(10 * 365 * 24 * 60 * 60);

export type RuntimeConfigIssue = {
  path: string;
  code: string;
};

export class InvalidRuntimeConfigError extends Error {
  readonly name = "InvalidRuntimeConfigError";
  readonly issues: RuntimeConfigIssue[];

  constructor(
    readonly runtime: string,
    error: z.ZodError,
  ) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    }));
    const locations = issues
      .map((issue) => `${issue.path || "<root>"} (${issue.code})`)
      .join(", ");
    super(`Invalid ${runtime} configuration: ${locations}.`);
    this.issues = issues;
  }
}

export type RuntimeConfigOptions<Value extends Record<string, unknown>> = {
  name: string;
  schema: z.ZodType<Value>;
  source: Readonly<Record<string, unknown>>;
};

export class RuntimeConfig<Value extends Record<string, unknown>> {
  static create<Value extends Record<string, unknown>>(
    options: RuntimeConfigOptions<Value>,
  ): RuntimeConfig<Value> {
    const result = options.schema.safeParse(options.source);
    if (!result.success) {
      throw new InvalidRuntimeConfigError(options.name, result.error);
    }
    return new RuntimeConfig<Value>(result.data);
  }

  private constructor(readonly value: Readonly<Value>) {
    Object.freeze(value);
  }
}
