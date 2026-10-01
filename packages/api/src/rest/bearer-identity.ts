import {
  SurfaceBlankSecretError,
  SurfaceUnconfiguredError,
  SurfaceUnverifiedError,
} from "../errors.ts";
import type { RestCaller, RestIdentity } from "./runtime.ts";
import { isInternalSecretValid } from "./security.ts";

export class BearerIdentity implements RestIdentity {
  readonly #name: string;
  readonly #token: string | undefined;
  private constructor(name: string, token: string | undefined) {
    this.#name = name;
    this.#token = token;
  }
  static create(options: { name: string; token: string | undefined }): BearerIdentity {
    return new BearerIdentity(options.name, options.token);
  }
  authenticate(): never {
    throw new SurfaceUnverifiedError(this.#name);
  }
  identify({ request }: { request: Request }): RestCaller {
    if (this.#token === void 0) throw new SurfaceUnconfiguredError(this.#name);

    if (this.#token.trim() === "") throw new SurfaceBlankSecretError(this.#name);

    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;

    if (!isInternalSecretValid({ authorizationHeader: token, expected: this.#token.trim() }))
      throw new SurfaceUnverifiedError(this.#name);

    return {
      actor: null,
      scope: null,
      internal: { type: "internalSecret", secretName: this.#name },
    };
  }
}
