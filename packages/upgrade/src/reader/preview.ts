import { z } from "zod";

import { compareReleases, releaseVersionSchema } from "../manifest/manifest.ts";
import { type UpgradePlan, upgradePlanSchema } from "../plan/plan-upgrade.ts";
import { upgradePreflightRowSchema } from "./preflight.ts";

/** A target this image does not ship: only the target image holds its manifests (Q-U3). */
export const upgradeTargetRefusalSchema = z.object({
  outcome: z.literal("refused"),
  code: z.literal("target_not_in_image"),
  stopAt: releaseVersionSchema,
  message: z.string(),
});
export type UpgradeTargetRefusal = z.infer<typeof upgradeTargetRefusalSchema>;

/**
 * The image's plan narrowed to `to` (upgrade-ui plan 6.1.2): releases after `to` are dropped,
 * and unreleased steps are kept only when `to` is this image's release. A target newer than the
 * image is refused with the command that previews from the target image itself.
 */
export function previewUpgradeTo({
  plan,
  image,
  to,
}: {
  plan: UpgradePlan;
  image: { release: string | null };
  to: string;
}): UpgradePlan | UpgradeTargetRefusal {
  if (image.release !== null && compareReleases({ left: to, right: image.release }) > 0) {
    return {
      outcome: "refused",
      code: "target_not_in_image",
      stopAt: to,
      message:
        `this image is ${image.release} and ships no manifest for ${to}; run ` +
        `\`pnpm task upgrade plan --to ${to}\` from the ${to} image with this installation's ` +
        `connection (for example \`docker run --rm <image>:${to} pnpm task upgrade plan --to ${to}\`)`,
    };
  }
  if (plan.outcome === "refused") return plan;
  const keepUnreleased = image.release === null || image.release === to;
  const releases = plan.releases.filter((release) =>
    release.release === null
      ? keepUnreleased
      : compareReleases({ left: release.release, right: to }) <= 0,
  );
  return { ...plan, releases };
}

/** The preview page's read: the plan narrowed to `to`, beside the preflight (U6-U9-READER). */
export const upgradePreviewSchema = z.object({
  installed: z.string().nullable(),
  plan: z.union([upgradePlanSchema, upgradeTargetRefusalSchema]),
  preflight: z.array(upgradePreflightRowSchema),
});
export type UpgradePreview = z.infer<typeof upgradePreviewSchema>;
