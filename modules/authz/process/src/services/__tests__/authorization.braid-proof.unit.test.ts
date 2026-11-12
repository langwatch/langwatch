/**
 * ADR-201 §1, §3 and §8: what a braid puts in the proof a reader's trace read carries, minted
 * over the ledger's memory twin. The fence reads only the projects a proof names.
 * @see modules/authz/specs/braids.feature
 */
import {
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_EVERY_SPAN,
  type GrantCondition,
  honourSpanBraids,
  type ProofBearingPermission,
  readScopeKeyOf,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import type { AuthzScopeRef } from "@langwatch/authz-contract";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { AuthorizationService } from "../authorization.service.ts";
import type { AuthzCollectorService } from "../authz-collector.service.ts";
import type { AuthzService } from "../authz.service.ts";

const ORG = "org_acme";
const SPECIALISTS = "proj_specialists";
const ORCHESTRATOR = "proj_orchestrator";
const FRONTDESK = "proj_frontdesk";
const SAM = { type: "user", id: "user_sam" } as const;
const ROUTE = { kind: "route", route: "traces.getTrace" } as const;
const OCTOBER_1 = "2026-10-01T00:00:00Z";
const WEB = 'attributes["orchestrator"] == "web"';

function compiledOf(text: string) {
  const compiled = compileBraidCondition({ text });
  if (!compiled.ok || !compiled.compiledWhere) throw new Error(`${text} did not compile`);
  return compiled.compiledWhere;
}

function spanCondition({ where, from = OCTOBER_1 }: { where?: string; from?: string }) {
  return where === undefined
    ? ({ type: "span", from } satisfies GrantCondition)
    : ({ type: "span", where, compiledWhere: compiledOf(where), from } satisfies GrantCondition);
}

/** The ledger's twin holding braids as the projection writes them, and a door minting over it. */
function ledger({ now }: { now: () => number }) {
  const memory = AuthzMemoryStore.create();
  const projection = MemoryAuthzGrantProjectionRepository.create({ memory });
  const reads = MemoryAuthzReadRepository.create({ memory });
  const braid = async ({
    id,
    owner,
    reader,
    condition,
    expiresAtMs,
    replacesGrantId,
  }: {
    id: string;
    owner: string;
    reader: string;
    condition: GrantCondition;
    expiresAtMs?: number;
    replacesGrantId?: string;
  }) =>
    projection.append({
      kind: "grant.upsert",
      row: {
        id,
        organizationId: ORG,
        principalType: "PROJECT",
        principalId: reader,
        legacyRole: null,
        source: "braid",
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: "user_ana",
        expiresAt:
          expiresAtMs === undefined ? null : Temporal.Instant.fromEpochMilliseconds(expiresAtMs),
        maxViews: null,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(Date.parse(OCTOBER_1)),
        roleKey: "project-reader",
        scopeType: "PROJECT",
        scopeId: owner,
        condition,
        ...(replacesGrantId === undefined ? {} : { replacesGrantId }),
      },
    });
  const door = AuthorizationService.create({
    authz: createApiFixture<Pick<AuthzService, "effectivePermissions">>({
      effectivePermissions: async () => [
        "project:view",
        "traces:view",
        "analytics:view",
        "cost:view",
      ],
    }),
    collector: createApiFixture<Pick<AuthzCollectorService, "findScopeRef">>({
      findScopeRef: async ({ projectId }) =>
        ({
          type: "project",
          id: projectId,
          teamId: `team_${projectId}`,
          organizationId: ORG,
        }) as AuthzScopeRef,
    }),
    sharedReads: reads,
    now,
  });
  const mint = (projectId: string, permission: ProofBearingPermission = "traces:view") =>
    door.authorize({
      actor: SAM,
      principal: SAM,
      permission,
      scope: { projectId },
      purpose: ROUTE,
    });
  return { memory, projection, braid, mint };
}

describe("the proof a reader's trace read carries", () => {
  describe("given specialists braided into orchestrator and orchestrator into frontdesk", () => {
    /** @scenario "Braids do not chain" */
    it("carries for frontdesk the braid from orchestrator and nothing braided into orchestrator", async () => {
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_into_orchestrator",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
      });
      await braid({
        id: "grant_into_frontdesk",
        owner: ORCHESTRATOR,
        reader: FRONTDESK,
        condition: spanCondition({ where: 'name == "frontdesk_call"' }),
      });

      const frontdesk = await mint(FRONTDESK);
      const orchestrator = await mint(ORCHESTRATOR);

      expect(
        frontdesk.grants.map(({ projectId, kind, via }) => ({ projectId, kind, via })),
      ).toEqual([
        { projectId: FRONTDESK, kind: "own", via: [] },
        { projectId: ORCHESTRATOR, kind: "shared", via: ["grant_into_frontdesk"] },
      ]);
      // The braid into orchestrator is live: it is left out of frontdesk's proof, not gone.
      expect(orchestrator.grants.map((grant) => grant.projectId)).toEqual([
        ORCHESTRATOR,
        SPECIALISTS,
      ]);
    });
  });

  describe("given a braid that ends at a date", () => {
    /** @scenario "A braid stops showing at its end date" */
    it("is carried only until the date, by proofs that end by it, and is never marked removed", async () => {
      const endsAt = Date.parse("2026-11-01T00:00:00Z");
      let now = endsAt - 60_000;
      const { braid, mint, memory } = ledger({ now: () => now });
      await braid({
        id: "grant_ending",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
        expiresAtMs: endsAt,
      });

      const beforeTheDate = await mint(ORCHESTRATOR);
      now = endsAt + 1;
      const afterTheDate = await mint(ORCHESTRATOR);

      expect(beforeTheDate.grants.map((grant) => grant.projectId)).toEqual([
        ORCHESTRATOR,
        SPECIALISTS,
      ]);
      expect(beforeTheDate.expiresAt).toBeLessThanOrEqual(endsAt);
      expect(afterTheDate.grants.map((grant) => grant.projectId)).toEqual([ORCHESTRATOR]);
      const [stored] = await MemoryAuthzLedgerReadRepository.create({ memory }).findBraids({
        organizationId: ORG,
        grantId: "grant_ending",
        includeRevoked: true,
      });
      expect(stored).toMatchObject({ isLive: true, revokedReason: null });
    });
  });

  describe("given a braid whose data starts on 1 October and which never ends", () => {
    /** @scenario '"Data from" limits which spans show, not how long the reader sees them' */
    it("carries the window's start as where spans begin, with no end, and keeps granting long after it", async () => {
      let now = Date.parse("2026-10-02T00:00:00Z");
      const { braid, mint } = ledger({ now: () => now });
      await braid({
        id: "grant_from_october",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
      });

      const second = await mint(ORCHESTRATOR);
      now = Date.parse("2027-03-01T00:00:00Z");
      const months = await mint(ORCHESTRATOR);

      for (const proof of [second, months]) {
        expect(proof.grants[1]?.condition).toMatchObject({
          from: Date.parse(OCTOBER_1),
          until: null,
        });
      }
      expect(months.grants.map((grant) => grant.projectId)).toEqual([ORCHESTRATOR, SPECIALISTS]);
    });
  });

  describe("given a braid saved with no condition", () => {
    /** @scenario "A braid with no condition braids every owner span in the reader's traces" */
    /** @scenario "A braid stored with no condition is minted as every span, stated" */
    it("carries the owner as a span window whose compiled form is every span, stated", async () => {
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_unconditioned",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({}),
      });

      const proof = await mint(ORCHESTRATOR);

      expect(proof.grants[1]).toEqual({
        projectId: SPECIALISTS,
        permissions: [SPAN_BRAID_PERMISSION],
        via: ["grant_unconditioned"],
        kind: "shared",
        condition: {
          type: "span",
          compiledWhere: BRAID_CONDITION_EVERY_SPAN,
          from: Date.parse(OCTOBER_1),
          until: null,
        },
      });
    });
  });

  describe("given stored braids written before every condition carried its compiled form", () => {
    /** @scenario "A braid stored with no condition is minted as every span, stated" */
    it("states every span for an empty where and leaves out a where with no compiled form", async () => {
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_empty_where",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: { type: "span", where: "", from: OCTOBER_1 },
      });
      await braid({
        id: "grant_uncompiled",
        owner: FRONTDESK,
        reader: ORCHESTRATOR,
        condition: { type: "span", where: WEB, from: OCTOBER_1 },
      });

      const proof = await mint(ORCHESTRATOR);

      expect(proof.grants.map(({ via, condition }) => ({ via, condition }))).toEqual([
        { via: [], condition: undefined },
        {
          via: ["grant_empty_where"],
          condition: {
            type: "span",
            compiledWhere: BRAID_CONDITION_EVERY_SPAN,
            from: Date.parse(OCTOBER_1),
            until: null,
          },
        },
      ]);
    });
  });

  describe("given a live braid and a proof minted on a trace, analytics or cost route", () => {
    /** @scenario "A minted braid grant carries only the braid permission" */
    it("carries spans:braided alone on the braid's grant, and on no other grant", async () => {
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_braid",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
      });

      for (const permission of ["traces:view", "analytics:view", "cost:view"] as const) {
        const [own, shared] = (await mint(ORCHESTRATOR, permission)).grants;

        expect({ permission, braid: shared?.permissions }).toEqual({
          permission,
          braid: [SPAN_BRAID_PERMISSION],
        });
        expect(own?.permissions).not.toContain(SPAN_BRAID_PERMISSION);
      }
    });
  });

  describe("given a braid changed to a narrower condition whose old grant the worker has not yet revoked", () => {
    /** @scenario "A replaced braid reads nothing once its replacement is live, even before the worker revokes it" */
    it("carries only the replacement, so the narrowing holds from the moment it is live", async () => {
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_wide",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({}),
      });
      await braid({
        id: "grant_narrowed",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
        replacesGrantId: "grant_wide",
      });

      const proof = await mint(ORCHESTRATOR);

      expect(proof.grants.map(({ via, condition }) => ({ via, where: condition?.where }))).toEqual([
        { via: [], where: undefined },
        { via: ["grant_narrowed"], where: WEB },
      ]);
    });

    /** @scenario "A replaced braid reads nothing once its replacement is live, even before the worker revokes it" */
    it("shuts the old grant out even when the replacement's stored condition cannot be read", async () => {
      // wrong-typed input: a stored condition no schema version can read
      const unreadable = { type: "unknown" } as unknown as GrantCondition;
      const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_wide",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({}),
      });
      await braid({
        id: "grant_unreadable",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: unreadable,
        replacesGrantId: "grant_wide",
      });

      const proof = await mint(ORCHESTRATOR);

      expect(proof.grants.map(({ via }) => via)).toEqual([[]]);
    });
  });

  describe("given a changed braid whose replacement is removed before the worker revokes the old one", () => {
    /** @scenario "Removing a changed braid before the worker revokes the old one never revives the old one" */
    it("never carries the old, wider grant again", async () => {
      const { braid, mint, projection } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
      await braid({
        id: "grant_wide",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({}),
      });
      await braid({
        id: "grant_narrowed",
        owner: SPECIALISTS,
        reader: ORCHESTRATOR,
        condition: spanCondition({ where: WEB }),
        replacesGrantId: "grant_wide",
      });
      await projection.append({
        kind: "grant.revoke",
        organizationId: ORG,
        grantId: "grant_narrowed",
        reason: "braid_removed",
        occurredAt: Temporal.Instant.fromEpochMilliseconds(Date.parse("2026-10-02T00:00:00Z")),
      });

      const proof = await mint(ORCHESTRATOR);

      expect(proof.grants.map(({ via }) => via)).toEqual([[]]);
    });
  });

  describe("given braids whose compiled conditions differ in tree or compiler version", () => {
    /** @scenario "A compiled condition carries the compiler's version" */
    it("keys the reader's read scope apart for each, and alike for the same condition", async () => {
      const keyOf = async (condition: GrantCondition) => {
        const { braid, mint } = ledger({ now: () => Date.parse("2026-10-20T00:00:00Z") });
        await braid({ id: "grant_keyed", owner: SPECIALISTS, reader: ORCHESTRATOR, condition });
        // Keyed as the span read keys it, once the trace module's plan check honoured the braid.
        return readScopeKeyOf(honourSpanBraids({ authorization: await mint(ORCHESTRATOR) }));
      };
      const web = spanCondition({ where: WEB });
      const nextCompiler: GrantCondition = {
        ...web,
        compiledWhere: { ...compiledOf(WEB), version: BRAID_CONDITION_COMPILER_VERSION + 1 },
      };

      const base = await keyOf(web);

      expect(await keyOf(spanCondition({ where: WEB }))).toBe(base);
      expect(await keyOf(spanCondition({ where: 'name == "payments_agent"' }))).not.toBe(base);
      expect(await keyOf(nextCompiler)).not.toBe(base);
    });
  });
});
