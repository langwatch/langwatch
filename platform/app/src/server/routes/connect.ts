/**
 * The connect host: what a self-hosted install calls on LangWatch Cloud
 * (ADR-139, section 6).
 *
 * `connect.langwatch.ai/v1/*` maps onto this basePath, so an install posting to
 * `https://connect.langwatch.ai/v1/license/sync` lands on
 * `/api/connect/v1/license/sync` here.
 *
 * Both routes are public in the sense that no gateway stands in front of them
 * and no session is read. The license token in `Authorization` is the whole
 * credential on the sync, and the statistics report has never carried one.
 *
 * Refusals are written in the gateway's error envelope, with the codes the
 * gateway already uses, so one piece of copy on the install covers both hosts.
 * A refusal says nothing about the customer, the seats or the term: the caller
 * may be holding a token it should not have.
 */

import { createLicenseSyncService } from "@ee/licensing/registry/composition";
import {
  LICENSE_SYNC_REFUSALS,
  type LicenseSyncRefusalCode,
} from "@ee/licensing/registry/licenseSync.service";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { prisma } from "~/server/db";
import { bodyLimit } from "./_lib/body-limit";
import {
  handleTrackUsage,
  TRACK_USAGE_MAX_BODY_BYTES,
} from "./_lib/track-usage";

const secured = createServiceApp({ basePath: "/api/connect/v1" });

const logger = createLogger("langwatch:connect-host");

/** The header an install presents its identity in, matching the gateway's. */
const INSTANCE_HEADER = "X-LangWatch-Instance";

/** A sync is a version and two seat counts; anything larger is not one. */
const SYNC_MAX_BODY_BYTES = 4 * 1024;

const WHY_PUBLIC =
  "a self-hosted install calls this with its license token, or with no credential at all for anonymous statistics; no gateway and no session stand in front of it";

/**
 * `POST /api/connect/v1/license/sync`
 *
 * Headers: `Authorization: Bearer lwl_<64 hex>`, `X-LangWatch-Instance: <id>`.
 * Body: `{version, seats: {members, liteMembers}}` and nothing else.
 * Answers `{lease, license?}`.
 */
secured
  .access(publicEndpoint(WHY_PUBLIC))
  .post(
    "/license/sync",
    bodyLimit({ maxSize: SYNC_MAX_BODY_BYTES }),
    async (c) => {
      const result = await createLicenseSyncService(prisma).recordSync({
        token: bearerToken(c.req.header("Authorization")),
        instanceId: c.req.header(INSTANCE_HEADER),
        body: await c.req.json().catch(() => null),
      });
      if (!result.ok) return refuse(c, result.code);
      return c.json({
        lease: result.lease,
        ...(result.license ? { license: result.license } : {}),
      });
    },
  );

/**
 * `POST /api/connect/v1/stats`
 *
 * The same anonymous daily report `POST /api/track_usage` takes, handled by the
 * same function. A connected install posts here; every other install, and every
 * install on an older version, keeps posting to the app host.
 */
secured
  .access(publicEndpoint(WHY_PUBLIC))
  .post(
    "/stats",
    bodyLimit({ maxSize: TRACK_USAGE_MAX_BODY_BYTES }),
    handleTrackUsage,
  );

/** The token out of a bearer header, or the empty string, which is malformed. */
function bearerToken(header: string | undefined): string {
  const value = header?.trim() ?? "";
  return value.toLowerCase().startsWith("bearer ")
    ? value.slice("bearer ".length).trim()
    : "";
}

function refuse(c: Context, code: LicenseSyncRefusalCode) {
  const refusal = LICENSE_SYNC_REFUSALS[code];
  logger.warn(
    { code, status: refusal.status },
    `license sync refused: ${code}`,
  );
  return c.json(
    { error: { type: code, code, message: refusal.message } },
    refusal.status as ContentfulStatusCode,
  );
}

export const app = secured.hono;
