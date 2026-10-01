import { createLangyFeatureMap } from "../../langy-feature-map.ts";
import rawFeatureMap from "./feature-map.generated.json" with { type: "json" };

const featureMap = createLangyFeatureMap(rawFeatureMap);

export const { FEATURES, featureForCliCommand, featureForCliToolName, featuresConsuming } =
  featureMap;

export type { FeatureNode, LangyFeatureMap, LangyFeatureMapSource } from "../../../index.ts";
