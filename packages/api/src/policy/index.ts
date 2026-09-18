// The base policy classes a process composes its responses from. Named values,
// never inline data: a deployment chains onto a default, it never assembles one.

export {
  ClientAddress,
  type AddressedRequest,
  type ClientAddressReporter,
} from "./client-address.ts";
export {
  ContentSecurityPolicy,
  storageConnectSources,
  type StorageEndpoints,
} from "./content-security-policy.ts";
export { SecurityHeaders } from "./security-headers.ts";
export {
  restSurfaceDefaults,
  trpcSurfaceDefaults,
  browserBundleDefaults,
  type SurfaceDefaultsOptions,
} from "./defaults.ts";
