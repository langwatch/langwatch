import { prisma } from "../../db";
import { deploymentOffersTwoStepVerification } from "./signin-method-policy";
import { TwoStepVerificationService } from "./two-step-verification.service";
import {
  BetterAuthTwoStepProtocol,
  PrismaTwoStepAccount,
} from "./two-step-verification-adapters";

/**
 * The account side of two-step verification, composed.
 *
 * Its own module rather than a function in `runtime.ts`, and the reason is a
 * cycle rather than taste: this composition reaches the two-factor plugin's
 * endpoints, which live on the better-auth instance, and better-auth's own
 * module imports `runtime.ts` for the identity ceremonies. Putting this
 * beside them would close that loop around a module that constructs
 * `betterAuth()` at load. Everything else about it is the composition root's
 * rule — Prisma and the environment meet the service here and nowhere else.
 */
export function twoStepVerification(): TwoStepVerificationService {
  return new TwoStepVerificationService({
    account: new PrismaTwoStepAccount(prisma),
    protocol: new BetterAuthTwoStepProtocol(),
    offered: deploymentOffersTwoStepVerification,
  });
}
