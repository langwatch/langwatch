export type { SelfHostedPlan } from "./types";
export { DEFAULT_PLAN, VALID_PLANS, isValidPlan } from "./types";
export {
  determinePlanFromLicenseKey,
  getSelfHostedPlan,
  isEeEnabled,
  hasPaidLicense,
} from "./check";
