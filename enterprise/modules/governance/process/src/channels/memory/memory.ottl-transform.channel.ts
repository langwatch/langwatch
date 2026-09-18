// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A twin with no gateway behind it.
 *
 * By default it answers exactly as the live channel does when it has no base
 * URL or secret configured — `validate` defers with `gateway_unconfigured`,
 * `transform` throws `OttlGatewayUnavailableError` — because that is the
 * honest state of a process with nothing bound: it has no OTTL engine to run
 * a statement against, so it must not claim a validation passed or a
 * transform succeeded. A test that wants a specific outcome passes it to
 * `create`, rather than have this twin fabricate one the live channel would
 * refuse.
 */
import {
  GovernanceOttlGateway,
  OttlGatewayUnavailableError,
  type OttlTransformInput,
  type OttlTransformResult,
  type OttlValidationResult,
} from "../ottl-transform.channel.ts";

const DEFAULT_VALIDATION_RESULT: OttlValidationResult = {
  status: "deferred",
  reason: "gateway_unconfigured",
};

export class MemoryOttlTransformChannel extends GovernanceOttlGateway {
  private constructor(
    private readonly validationResult: OttlValidationResult,
    private readonly transformResult: ((input: OttlTransformInput) => OttlTransformResult) | null,
  ) {
    super();
  }

  static create(
    options: {
      validationResult?: OttlValidationResult;
      transform?: (input: OttlTransformInput) => OttlTransformResult;
    } = {},
  ): MemoryOttlTransformChannel {
    return new MemoryOttlTransformChannel(
      options.validationResult ?? DEFAULT_VALIDATION_RESULT,
      options.transform ?? null,
    );
  }

  async validate(_statements: string[]): Promise<OttlValidationResult> {
    return this.validationResult;
  }

  async transform(input: OttlTransformInput): Promise<OttlTransformResult> {
    if (!this.transformResult) {
      throw new OttlGatewayUnavailableError("No OTTL gateway is configured for this memory channel");
    }
    return this.transformResult(input);
  }
}
