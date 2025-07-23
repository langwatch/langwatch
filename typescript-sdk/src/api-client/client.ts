import { createClient, type NormalizeOAS, type ClientPlugin } from "fets";
import type openAPIDoc from "./langwatch-openapi.json";
import { getEnv } from "../utils";

export function useAuth(token: string): ClientPlugin {
  return {
    onRequestInit({ requestInit }) {
      requestInit.headers = {
        ...requestInit.headers,
        Authorization: `Bearer ${token}`,
      };
    },
  };
}

const env = getEnv();

// @ts-expect-error - Excessively deep type inference
export const client = createClient<NormalizeOAS<typeof openAPIDoc>>({
  endpoint: env.LANGWATCH_ENDPOINT,
  plugins: [useAuth(env.LANGWATCH_API_KEY)],
});
