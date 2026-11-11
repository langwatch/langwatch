import { readFileSync } from "node:fs";

import chalk from "chalk";

import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import type { CreateEvaluatorBody } from "@/client-sdk/services/evaluators";

import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { closestEvaluatorTypes, isValidEvaluatorType } from "./catalog";

type CreateEvaluatorOptions = { type?: string; code?: string; input?: string[] };

/** Fails the command with a validation error before any network call. */
const refuse = (message: string, fields: string[]): never => {
  reportCommandError({ error: commandValidationError(message, { fields }) });
  process.exit(1);
};

/** `name` or `name:type`, the type defaulting to `str` as the editor's does. */
const parseCodeInput = (spec: string): { identifier: string; type: string } => {
  const [identifier = "", type = "str"] = spec.split(":", 2).map((part) => part.trim());
  if (!identifier || !type) refuse(`--input "${spec}" must be name or name:type`, ["input"]);
  return { identifier, type };
};

/** A built-in evaluator, its catalogue type checked before any network call. */
const builtInEvaluatorBody = (name: string, type: string): CreateEvaluatorBody => {
  // A type slug the platform would reject fails HERE, before any network
  // round-trip, with the closest real slugs in the message and the same
  // reason shape the server's 422 carries (meta.field / expected / received).
  if (!isValidEvaluatorType(type)) {
    const closest = closestEvaluatorTypes(type);
    reportCommandError({
      error: {
        ...commandValidationError(
          `Unknown evaluator type "${type}". Closest matches: ${closest.join(", ")}. Run \`langwatch evaluator types\` for the full list.`,
          { fields: ["type"] },
        ),
        reasons: [
          {
            kind: "schema_failure",
            meta: {
              field: "type",
              expected: closest,
              received: type,
            },
          },
        ],
      },
    });
    process.exit(1);
  }
  return { name, config: { evaluatorType: type } };
};

/** A custom code evaluator: the program from a file, its inputs from the flags. */
const codeEvaluatorBody = (name: string, options: CreateEvaluatorOptions): CreateEvaluatorBody => {
  const inputs = (options.input ?? []).map(parseCodeInput);
  if (inputs.length === 0) {
    refuse("A code evaluator needs at least one --input (e.g. --input output)", ["input"]);
  }
  let code = "";
  try {
    code = readFileSync(options.code ?? "", "utf8");
  } catch {
    refuse(`Could not read the code file "${options.code}"`, ["code"]);
  }
  if (!code.trim()) refuse(`The code file "${options.code}" is empty`, ["code"]);
  return { name, type: "code", config: { code, inputs } };
};

/**
 * Returns the created evaluator rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createEvaluatorCommand = async (
  name: string,
  options: CreateEvaluatorOptions,
): Promise<CommandResult | void> => {
  if ((options.type === void 0) === (options.code === void 0)) {
    refuse(
      "Pass exactly one of --type <evaluatorType> (a built-in evaluator) or --code <file> (a custom code evaluator)",
      ["type", "code"],
    );
  }
  const body =
    options.code === void 0
      ? builtInEvaluatorBody(name, options.type ?? "")
      : codeEvaluatorBody(name, options);

  await resolveCredentials();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner(`Creating evaluator "${name}"...`).start();

  let evaluator: Awaited<ReturnType<EvaluatorsApiService["create"]>>;
  try {
    evaluator = await service.create(body);

    spinner.succeed(
      `Created evaluator "${chalk.cyan(evaluator.name)}" ${chalk.gray(`(slug: ${evaluator.slug ?? "—"})`)}`,
    );
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "create evaluator" });
    process.exit(1);
  }

  return {
    data: evaluator,
    table: () => {
      if (evaluator.platformUrl) {
        console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
      }
    },
  };
};
