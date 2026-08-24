import { ValidationError } from "@langwatch/handled-error";

export class GovernanceValidationError extends ValidationError {
  constructor(
    message: string,
    readonly meta: { formErrors: string[] },
  ) {
    super(message, { meta });
    this.name = "GovernanceValidationError";
  }
}

export function unsupportedGovernanceValue(input: {
  field: string;
  value: string;
  allowed: readonly string[];
}): GovernanceValidationError {
  const complaint = `Unsupported ${input.field} "${input.value}". Allowed: ${input.allowed.join(", ")}.`;
  return new GovernanceValidationError(complaint, {
    formErrors: [complaint],
  });
}

export const unsupportedValue = unsupportedGovernanceValue;
