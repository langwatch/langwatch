import {
  InstantEvalApi,
  instantEvalConfig,
  type InstantEvalApi as InstantEvalApiContract,
} from "@langwatch/instant-eval-contract";

export class InstantEvalApp implements InstantEvalApiContract {
  static readonly contract = InstantEvalApi;
  static readonly dependencies = {};
  static readonly config = instantEvalConfig;

  private constructor() {}

  static create(): InstantEvalApp {
    return new InstantEvalApp();
  }
}
