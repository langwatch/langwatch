import type {
  OperatorFeatureFlag,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import type { OpsKillSwitchDescriptor } from "../app/ops.app.ts";

const UNSET: Pick<
  OperatorFeatureFlag,
  "storedValue" | "rules" | "envOverride" | "effective" | "lastEditedBy" | "updatedAt"
> = {
  storedValue: null,
  rules: [],
  envOverride: null,
  effective: false,
  lastEditedBy: null,
  updatedAt: null,
};

/**
 * Adds every kill switch the live pipeline graph will read to the operator's
 * flag list, naming the component behind it. A switch with no stored row
 * still has to be visible.
 */
export function withKillSwitchDescriptors({
  catalogue,
  descriptors,
}: {
  catalogue: OperatorFeatureFlagCatalogue;
  descriptors: readonly OpsKillSwitchDescriptor[];
}): OperatorFeatureFlagCatalogue {
  const described = descriptors.map((descriptor): OperatorFeatureFlag => {
    const existing = catalogue.flags.find((flag) => flag.key === descriptor.key);
    return {
      ...(existing ?? UNSET),
      key: descriptor.key,
      scope: "SYSTEM",
      defaultValue: existing?.defaultValue ?? false,
      description: `Pipeline ${descriptor.pipelineName} ${descriptor.componentType} ${descriptor.componentName}.`,
      family: "Event sourcing",
    };
  });

  const describedKeys = described.map((flag) => flag.key);
  return {
    ...catalogue,
    flags: [...catalogue.flags.filter((flag) => !describedKeys.includes(flag.key)), ...described],
  };
}
