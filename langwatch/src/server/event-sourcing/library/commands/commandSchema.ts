import { type z, type ZodSchema } from "zod";
import type { CommandType } from "../domain/commandType";

/**
 * Validation function type for command payloads.
 * Returns true if the payload is valid, false otherwise.
 * @deprecated Use Zod schemas instead via defineCommandSchema with a Zod schema.
 */
export type CommandPayloadValidator<Payload> = (
  payload: unknown,
) => payload is Payload;

/**
 * Command schema that defines a command type with its payload type and validation.
 * This provides type safety and runtime validation for commands.
 */
export interface CommandSchema<Payload, Type extends CommandType> {
  /**
   * The command type identifier.
   */
  readonly type: Type;
  /**
   * Validation function that checks if a payload matches the expected type.
   * Should return true if valid, false otherwise.
   */
  readonly validate: CommandPayloadValidator<Payload>;
  /**
   * Optional description of the command for documentation.
   */
  readonly description?: string;
}

/**
 * Creates a command schema with type safety and validation using a Zod schema.
 *
 * @param type - The command type identifier
 * @param schema - Zod schema for validating the payload
 * @param description - Optional description
 * @returns A command schema instance
 *
 * @example
 * ```typescript
 * const spanIngestionSchema = defineCommandSchema(
 *   "lw.obs.span.ingestion.record",
 *   storeSpanIngestionCommandDataSchema
 * );
 * ```
 */
export function defineCommandSchema<
  Schema extends ZodSchema,
  Type extends CommandType = CommandType,
>(
  type: Type,
  schema: Schema,
  description?: string,
): CommandSchema<z.infer<Schema>, Type>;

/**
 * Creates a command schema with type safety and validation using a type guard function.
 * @deprecated Use Zod schemas instead for better error messages and type inference.
 *
 * @param type - The command type identifier
 * @param validate - Validation function for the payload
 * @param description - Optional description
 * @returns A command schema instance
 */
export function defineCommandSchema<
  Payload,
  Type extends CommandType = CommandType,
>(
  type: Type,
  validate: CommandPayloadValidator<Payload>,
  description?: string,
): CommandSchema<Payload, Type>;

export function defineCommandSchema<
  PayloadOrSchema,
  Type extends CommandType = CommandType,
>(
  type: Type,
  schemaOrValidate: ZodSchema | CommandPayloadValidator<PayloadOrSchema>,
  description?: string,
): CommandSchema<PayloadOrSchema, Type> {
  // Check if it's a Zod schema (has safeParse method)
  if (
    typeof schemaOrValidate === "object" &&
    schemaOrValidate !== null &&
    "safeParse" in schemaOrValidate &&
    typeof schemaOrValidate.safeParse === "function"
  ) {
    return {
      type,
      validate: (payload: unknown): payload is PayloadOrSchema => {
        const result = schemaOrValidate.safeParse(payload);
        return result.success;
      },
      description,
    };
  }

  // Otherwise, treat it as a type guard function
  const validate = schemaOrValidate as CommandPayloadValidator<PayloadOrSchema>;
  return {
    type,
    validate,
    description,
  };
}
