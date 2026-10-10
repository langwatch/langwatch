import { Config, isSaas, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

const blankIsUnset = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? void 0 : value;
const releaseName = z.preprocess(blankIsUnset, z.string().trim().max(100).optional());
const commitHash = z.preprocess(
  blankIsUnset,
  z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,40}$/, "a git commit hash, 7 to 40 lowercase hex characters")
    .optional(),
);

export const saasConfig = Config.define((c) => ({
  /** Whether this deployment is LangWatch Cloud: the shared `isSaas` leaf, one claim among many. */
  isSaas,
  /** The newest release Cloud names in its usage-report answer; unset names none. */
  latestRelease: c.env("LANGWATCH_LATEST_RELEASE", releaseName),
  /** The commit that release was built from: a release is one identity only with its commit. */
  latestReleaseCommit: c.env("LANGWATCH_LATEST_RELEASE_COMMIT", commitHash),
  /** The oldest release an install may run, named in the same answer; unset names none. */
  releaseFloor: c.env("LANGWATCH_RELEASE_FLOOR", releaseName),
}));

export type SaasServerConfig = ConfigOf<typeof saasConfig>;
