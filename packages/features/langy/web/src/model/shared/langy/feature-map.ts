import rawFeatureMap from "../../../../../../../../feature-map.json";
import { createLangyFeatureMap, parseCliToolName } from "../../../index";

const featureMap = createLangyFeatureMap(rawFeatureMap);

export const {
  FEATURES,
  featureForCliCommand,
  featureForCliToolName,
  featuresConsuming,
} = featureMap;

export { parseCliToolName };
export type {
  CliCommand,
  FeatureNode,
  LangyFeatureMap,
  LangyFeatureMapSource,
} from "../../../index";
