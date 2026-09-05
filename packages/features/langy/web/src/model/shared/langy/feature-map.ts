import rawFeatureMap from "./feature-map.generated.json";
import { createLangyFeatureMap, parseCliToolName } from "../../langy-feature-map";

const featureMap = createLangyFeatureMap(rawFeatureMap);

export const { FEATURES, featureForCliCommand, featureForCliToolName, featuresConsuming } =
  featureMap;

export { parseCliToolName };
export type {
  CliCommand,
  FeatureNode,
  LangyFeatureMap,
  LangyFeatureMapSource,
} from "../../../index";
