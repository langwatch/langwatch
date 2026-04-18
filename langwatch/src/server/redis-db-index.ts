// Parses the REDIS_DB_INDEX env var into a validated 0..15 integer.
// Returns 0 for anything unset, malformed, or out of range — this is a dev
// affordance, not a hard config, so we never throw here.
const VALID = /^(?:[0-9]|1[0-5])$/;

export const parseRedisDbIndex = (raw: string | undefined): number => {
  if (!raw) return 0;
  if (!VALID.test(raw)) return 0;
  return Number(raw);
};
