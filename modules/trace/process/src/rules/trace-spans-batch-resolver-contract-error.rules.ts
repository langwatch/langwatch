const ERROR_NAME = "TraceSpansBatchResolverContractError";

function traceSpansBatchResolverContractError(message: string): Error {
  const error = new Error(message);
  error.name = ERROR_NAME;
  return error;
}

export function traceSpansBatchResolverCardinalityError({
  got,
  expected,
}: {
  got: number;
  expected: number;
}): Error {
  return traceSpansBatchResolverContractError(
    `resolveTraceSpansBatch returned ${got} resolution(s) for ${expected} trace(s); it must return exactly one per input trace, in input order`,
  );
}

export function traceSpansBatchResolverMisalignedError({
  index,
  expected,
  got,
}: {
  index: number;
  expected: string;
  got: string;
}): Error {
  return traceSpansBatchResolverContractError(
    `resolveTraceSpansBatch returned ${got} at position ${index}, where ${expected} was supplied; resolutions must come back in input order`,
  );
}

export function isTraceSpansBatchResolverContractError(error: unknown): boolean {
  return error instanceof Error && error.name === ERROR_NAME;
}
