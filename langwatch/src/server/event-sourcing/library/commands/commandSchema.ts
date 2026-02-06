import type { ZodSchema, z } from "zod";
import { createLogger } from "~/utils/logger/server";
import type { CommandType } from "../domain/commandType";
import { mapZodIssuesToLogContext } from "~/utils/zod";

const logger = createLogger("langwatch:event-sourcing:command-schema");

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
  readonly validate: (
    payload: unknown,
  ) => z.SafeParseReturnType<unknown, Payload>;
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
 *   "lw.obs.span_ingestion.record",
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
): CommandSchema<z.infer<Schema>, Type> {
  return {
    type,
    validate: (payload: unknown): z.SafeParseReturnType<unknown, Schema> => {
      const result = schema.safeParse(payload);
      if (!result.success) {
        logger.error(
          {
            commandType: type,
            zodIssues: mapZodIssuesToLogContext(result.error.issues),
          },
          "Command payload validation failed",
        );
      }

      return result;
    },
    description,
  };
}
