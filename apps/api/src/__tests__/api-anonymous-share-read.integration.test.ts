import { generate } from "@langwatch/ksuid";
/**
 * The anonymous shared-trace read, metered by the counters the api's own composition holds, on the
 * api booted wholly live (with the worker beside it, as the local launcher hosts both) over
 * Postgres, Redis and ClickHouse (§7). Each ceiling is observed by the refusal it produces.
 * @vitest-environment node
 * @see specs/server/api-process-anonymous-share-read.feature
 */
import { ShareApi } from "@langwatch/share-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootLiveApi,
  callTrpc,
  liveStoresConfigured,
  openLivePrisma,
  removeSeededTraces,
  removeSignedUpRows,
  seedOrganization,
  seedTraceSummary,
  type LiveApi,
} from "./api-live.fixture.ts";

const TOKEN_CEILING = 60;
const ADDRESS_CEILING = 120;

const database = liveStoresConfigured ? openLivePrisma({ label: "anonymous-share-read" }) : null;
const prisma = database?.prisma as NonNullable<typeof database>["prisma"];
const organizationIds: string[] = [];
const projectIds: string[] = [];

let addresses = 0;
/** An address this suite has not used, so one test's reads never spend another's budget. */
const freshAddress = () => `203.0.${113 + Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`;

describe.skipIf(!liveStoresConfigured)("the anonymous shared-trace read", () => {
  let api: LiveApi;
  let projectId: string;

  /** A public share link on a trace the live ClickHouse answers to; answers its token. */
  async function shareLink(): Promise<string> {
    const traceId = `trace-shared-${generate("test").toString()}`;
    await seedTraceSummary({ tenantId: projectId, traceId });
    const share = await api.application.service(ShareApi).createShare({
      projectId,
      resourceType: "TRACE",
      resourceId: traceId,
      visibility: "PUBLIC",
    });

    return share.token;
  }

  /** One read of the link with no session, from `address`. */
  const open = ({ token, address }: { token: string; address: string }) =>
    callTrpc({
      api,
      path: "sharedTrace.get",
      kind: "query",
      input: { token },
      headers: { "x-forwarded-for": address },
    });

  beforeAll(async () => {
    api = await bootLiveApi({ withWorker: true });
    const seeded = await seedOrganization({ prisma, label: "share-read" });
    organizationIds.push(seeded.organization.id);
    projectId = seeded.project.id;
    projectIds.push(projectId);
  }, 180_000);

  afterAll(async () => {
    await api?.close();
    await removeSeededTraces({ tenantIds: projectIds });
    await removeSignedUpRows({ prisma, userIds: [], organizationIds });
    await database?.close();
  }, 60_000);

  describe("given the API process composed the observability collaborators", () => {
    describe("when somebody with no session opens a shared trace link", () => {
      /** @scenario "An anonymous share read is metered against the process's own counter" */
      it("counts the read against the share token and the caller's address, and answers the payload", async () => {
        const first = await shareLink();
        const answered = await open({ token: first, address: freshAddress() });
        expect(answered.status).toBe(200);
        expect((answered.data as { project: { id: string } }).project.id).toBe(projectId);

        for (let read = 2; read <= TOKEN_CEILING; read += 1) {
          expect((await open({ token: first, address: freshAddress() })).status).toBe(200);
        }
        const overToken = await open({ token: first, address: freshAddress() });
        expect(overToken.status).toBe(429);
        expect(overToken.body).toContain("share_read_rate_limited");

        const crowded = freshAddress();
        const links = [await shareLink(), await shareLink(), await shareLink()];
        for (const token of links) {
          for (let read = 0; read < ADDRESS_CEILING / links.length; read += 1) {
            expect((await open({ token, address: crowded })).status).toBe(200);
          }
        }
        const untouched = await shareLink();
        const overAddress = await open({ token: untouched, address: crowded });
        expect(overAddress.status).toBe(429);
        expect(overAddress.body).toContain("share_read_rate_limited");
        expect((await open({ token: untouched, address: freshAddress() })).status).toBe(200);
      }, 180_000);
    });
  });
});
