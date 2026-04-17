import { describe, expect, it } from "vitest";
import { evaluatorsSchema } from "../evaluators.generated";
import type { ZodTypeAny } from "zod";

describe("evaluator schema consistency", () => {
  it("every evaluator exposes a settings schema", () => {
    const missing: string[] = [];
    for (const [name, schema] of Object.entries(evaluatorsSchema.shape)) {
      if (!schema.shape?.settings) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("defaults are populated when parsing {} for fields that have defaults", () => {
    const mismatches: string[] = [];
    for (const [name, schema] of Object.entries(evaluatorsSchema.shape)) {
      const settings = schema.shape.settings as ZodTypeAny & { shape: Record<string, ZodTypeAny> };
      const result = settings.safeParse({});
      if (!result.success) continue; // covered by next test
      const shape = settings.shape ?? {};
      for (const [field, fieldSchema] of Object.entries(shape)) {
        const def = (fieldSchema as any)._def;
        if (def?.defaultValue === undefined) continue;
        const expected = typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
        const actual = (result.data as Record<string, unknown>)[field];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push(`${name}.${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("evaluators without required fields parse {} successfully", () => {
    const failures: string[] = [];
    for (const [name, schema] of Object.entries(evaluatorsSchema.shape)) {
      const settings = schema.shape.settings as ZodTypeAny & { shape: Record<string, ZodTypeAny> };
      const result = settings.safeParse({});
      if (result.success) continue;
      const hasRequired = Object.values(settings.shape ?? {}).some((s) => {
        const def = (s as any)._def;
        const tn = def?.typeName;
        return (
          def?.defaultValue === undefined &&
          tn !== "ZodOptional" &&
          tn !== "ZodNullable" &&
          tn !== "ZodDefault"
        );
      });
      if (!hasRequired) {
        failures.push(`${name}: {} rejected with no required fields — ${result.error.issues.map((i) => `${i.path.join(".")}:${i.code}`).join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
