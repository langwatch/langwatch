/**
 * Legacy import bridge. The browser-safe runtime projection belongs to the
 * physical UI application; this module intentionally contains no parser.
 */
export {
  LOCAL_GATEWAY_URL,
  PublicAppConfigService,
  resolveGatewayBaseUrl,
  resolvePublicAppConfig,
  SAAS_GATEWAY_URL,
  type GatewayBaseUrlSource,
  type PublicAppConfigSource,
} from "@langwatch/ui/public-config";
