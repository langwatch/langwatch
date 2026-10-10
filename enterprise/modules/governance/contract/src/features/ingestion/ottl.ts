import { ValidationError } from "@langwatch/handled-error";
import { z } from "zod";

export const ottlValidationErrorSchema = z
  .object({
    statementIndex: z.number().int().nonnegative(),
    line: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    message: z.string(),
  })
  .strict();
export type OttlValidationError = z.infer<typeof ottlValidationErrorSchema>;

export const ottlValidationDeferredReasonSchema = z.enum([
  "gateway_unconfigured",
  "endpoint_unavailable",
]);
export type OttlValidationDeferredReason = z.infer<typeof ottlValidationDeferredReasonSchema>;

export const ottlValidationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid") }).strict(),
  z
    .object({
      status: z.literal("invalid"),
      errors: z.array(ottlValidationErrorSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal("deferred"),
      reason: ottlValidationDeferredReasonSchema,
    })
    .strict(),
]);
export type OttlValidationResult = z.infer<typeof ottlValidationResultSchema>;

export const ottlEncodingSchema = z.enum(["proto", "json"]);
export type OttlEncoding = z.infer<typeof ottlEncodingSchema>;

export const ottlTransformInputSchema = z
  .object({
    sourceId: z.string().min(1),
    kind: z.enum(["log", "metric"]),
    encoding: ottlEncodingSchema,
    payloadB64: z.string().min(1),
    statements: z.array(z.string()),
  })
  .strict();
export type OttlTransformInput = z.infer<typeof ottlTransformInputSchema>;

export const ottlTransformResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      payloadB64: z.string().min(1),
      encoding: ottlEncodingSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      errors: z.array(ottlValidationErrorSchema),
    })
    .strict(),
]);
export type OttlTransformResult = z.infer<typeof ottlTransformResultSchema>;

export abstract class GovernanceOttlGateway {
  abstract validate(statements: string[]): Promise<OttlValidationResult>;
  abstract transform(input: OttlTransformInput): Promise<OttlTransformResult>;
}

export class OttlGatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OttlGatewayUnavailableError";
  }
}

const UNEXPECTED_TOKEN = /unexpected token "((?:[^"\\]|\\.)*)"(?: \(expected (.*)\))?/;
const QUOTED = /"((?:[^"\\]|\\.)*)"/g;
const NOISE_PREFIX =
  /^(?:.*?invalid syntax: |unable to parse OTTL statement ".*?": )?(?:\d+:\d+: )?/;

/** The parser's grammar dump as a sentence an admin can act on. */
export function describeOttlError({
  statement,
  error,
}: {
  statement: string;
  error: OttlValidationError;
}): string {
  const match = UNEXPECTED_TOKEN.exec(error.message);
  if (!match) {
    const rest = error.message.replace(NOISE_PREFIX, "");
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  const [, token = "", expectedRaw = ""] = match;
  const expected = [...expectedRaw.matchAll(QUOTED)].map((m) => `\`${m[1]}\``).join(" or ");
  if (token === "<EOF>") {
    return expected ? `The statement ends early: expected ${expected}` : "The statement ends early";
  }
  const lines = statement.split("\n");
  const before = (lines[error.line - 1] ?? statement).slice(0, Math.max(0, error.col - 1));
  const after = /[^\s(,]*$/.exec(before.trimEnd())?.[0] ?? "";
  const where = after ? ` after \`${after}\`` : "";
  return expected
    ? `Expected ${expected}${where}, found \`${token}\``
    : `Unexpected \`${token}\`${where}`;
}

/** Save refused: the gateway's parser rejected at least one statement. */
export class OttlStatementsInvalidError extends ValidationError {
  constructor({ statements, errors }: { statements: string[]; errors: OttlValidationError[] }) {
    const problems = errors.map(
      (error) =>
        `Statement ${error.statementIndex + 1}: ${describeOttlError({ statement: statements[error.statementIndex] ?? "", error })}.`,
    );
    super(`These OTTL statements don't parse. ${problems.join(" ")}`, {
      meta: {
        fieldErrors: Object.fromEntries(
          errors.map((error, i) => [`ottlStatements.${error.statementIndex}`, [problems[i]]]),
        ),
        ottlErrors: errors,
      },
    });
    this.name = "OttlStatementsInvalidError";
  }
}
