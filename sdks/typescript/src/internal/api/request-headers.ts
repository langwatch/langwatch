import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
} from "../constants";
import { scopedSurface } from "../credentialContext";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "../surface";
import { buildAuthHeaders, type LangWatchAuthHeadersInput } from "./auth";

export function buildSdkIdentityHeaders(
  { surface = scopedSurface() }: { surface?: "cli" } = {},
): Record<string, string> {
  return {
    "user-agent": `langwatch-sdk-node/${LANGWATCH_SDK_VERSION}`,
    "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
    "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
    "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
    "x-langwatch-sdk-platform": LANGWATCH_SDK_RUNTIME(),
    ...(surface === "cli" ? { [CLI_SURFACE_HEADER]: CLI_SURFACE_VALUE } : {}),
  };
}

export function buildRequestHeaders(
  credentials: LangWatchAuthHeadersInput,
): Record<string, string> {
  return {
    ...buildAuthHeaders(credentials),
    ...buildSdkIdentityHeaders(),
  };
}
