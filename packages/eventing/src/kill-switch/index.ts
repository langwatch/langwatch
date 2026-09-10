export type {
  EsKillSwitchKey,
  KillSwitchComponent,
  KillSwitchComponentSource,
  KillSwitchComponentType,
  KillSwitchDescriptor,
  KillSwitchOptions,
} from "./killSwitchKeys.ts";
export { generateKillSwitchKey, killSwitchDescriptorsFor } from "./killSwitchKeys.ts";
export type { KillSwitchQuery } from "./killSwitch.port.ts";
export { isComponentKilled, KillSwitch } from "./killSwitch.port.ts";
