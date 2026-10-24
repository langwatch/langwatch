/** An Error with a stable `code`, so tests assert on the code and not the prose. */
export class CodedError extends Error {
  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.name = "CodedError";
    this.code = code;
  }

  readonly code: string;
}
