import createClient from "openapi-fetch";
import type { paths } from "./langwatch-openapi.ts";
import { getEnv } from "../utils";

const env = getEnv();

export const client = createClient<paths>({
  baseUrl: env.LANGWATCH_ENDPOINT,
});
