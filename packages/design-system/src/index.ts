export {
  createDesignSystem,
  designSystemConfig,
  type DesignSystemExtension,
  DRAWER_SIZE_2XL_MAX_WIDTH,
  drawerSlotRecipe,
  system,
} from "./system/index.ts";
export { DesignSystemProvider, type DesignSystemProviderProps } from "./provider/index.tsx";
export {
  BASE_OVERLAY_Z_INDEX,
  OverlayDepthContext,
  useOverlayZIndex,
  Z_INDEX_DEPTH_INCREMENT,
} from "./overlays/depth.ts";
