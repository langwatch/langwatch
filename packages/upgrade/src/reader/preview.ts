import { z } from "zod";

import { compareReleases, releaseVersionSchema } from "../manifest/manifest.ts";
import type { ReleaseManifest } from "../manifest/manifest.ts";
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
 * The image's plan narrowed to `to` (upgrade-ui plan 6.1.2), unreleased steps kept only when `to`
 * is this image's release. A target past the image, or past an unreleased image's newest
 * manifest (OPS-13), is refused with the command that previews from the target image itself.
 */
export function previewUpgradeTo({
  plan,
  image,
  manifests = [],
  to,
}: {
  plan: UpgradePlan;
  image: { release: string | null };
  /** The manifests this image ships; an unreleased image previews no further than the newest. */
  manifests?: readonly Pick<ReleaseManifest, "release">[];
  to: string;
}): UpgradePlan | UpgradeTargetRefusal {
  const newest = image.release ?? newestRelease({ manifests });
  if (newest !== null && compareReleases({ left: to, right: newest }) > 0) {
    return {
      outcome: "refused",
      code: "target_not_in_image",
      stopAt: to,
      message:
        `this image is ${image.release ?? "unreleased"} and ships no manifest for ${to}; run ` +
        `\`pnpm task upgrade plan --to ${to}\` from the ${to} image with this installation's ` +
        `connection (for example \`docker run --rm <image>:${to} pnpm task upgrade plan --to ${to}\`)`,
    };
  }
  const keepUnreleased = image.release === null || image.release === to;
  const releases = plan.releases.filter((release) =>
    release.release === null
      ? keepUnreleased
      : compareReleases({ left: release.release, right: to }) <= 0,
  );
  return { ...plan, releases };
}

function newestRelease({
  manifests,
}: {
  manifests: readonly Pick<ReleaseManifest, "release">[];
}): string | null {
  return manifests.reduce<string | null>(
    (newest, { release }) =>
      newest === null || compareReleases({ left: release, right: newest }) > 0 ? release : newest,
    null,
  );
}

/** The preview page's read: the plan narrowed to `to`, beside the preflight (U6-U9-READER). */
export const upgradePreviewSchema = z.object({
  installed: z.string().nullable(),
  plan: z.union([upgradePlanSchema, upgradeTargetRefusalSchema]),
  preflight: z.array(upgradePreflightRowSchema),
});
export type UpgradePreview = z.infer<typeof upgradePreviewSchema>;
