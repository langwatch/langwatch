import { makeAigatewayPredep } from "./aigateway.ts";
import { clickhousePredep } from "./clickhouse.ts";
import { postgresPredep } from "./postgres.ts";
import { redisPredep } from "./redis.ts";
import { uvPredep } from "./uv.ts";
import type { Predep } from "./types.ts";

export function predepRegistry({ version }: { version: string }): Predep[] {
  return [uvPredep, postgresPredep, redisPredep, clickhousePredep, makeAigatewayPredep(version)];
}
