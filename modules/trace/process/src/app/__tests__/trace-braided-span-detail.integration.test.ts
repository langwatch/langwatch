/**
 * The span panel on a braided span (ADR-185 §5, §8): redacted under its owner's policy and the
 * viewer's standing on the owner, saying who owns it, and audited.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type DataPrivacyApi,
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { baseSpanSchema, type Span } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { braidedProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { SpanCostSuggestionService } from "../../features/span/services/span-cost-suggestion.service.ts";
import { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import type { TracesSpanReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const CONDITION = 'attributes["orchestrator"] == "web"';
const ADMIN = ["traces:view", "traces:update", "project:manage", "cost:view"];

type Category = { disposition: "restrict"; audience: typeof EMPTY_AUDIENCE };
const policyHiding = (input: Category, output: Category = input) => ({
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories, input, output },
});
const HIDDEN_FROM_EVERYONE: Category = { disposition: "restrict", audience: EMPTY_AUDIENCE };
const ADMINS_ONLY: Category = {
  disposition: "restrict",
  audience: { ...EMPTY_AUDIENCE, admins: true },
};

function spanOf(owner: string): Span {
  return baseSpanSchema.parse({
    span_id: "span-1",
    trace_id: "trace-1",
    type: "span",
    timestamps: { started_at: 1_700_000_000_000, finished_at: 1_700_000_000_010 },
    input: { type: "text", value: `${owner} input` },
    output: { type: "text", value: `${owner} output` },
  });
}

function spanPanel({
  ownerPolicy,
  held,
}: {
  ownerPolicy: ReturnType<typeof policyHiding>;
  held: Record<string, string[]>;
}) {
  const hasPermission = async ({
    projectId,
    permission,
  }: {
    projectId?: string;
    permission: string;
  }) => (held[projectId ?? ""] ?? []).includes(permission);
  const recordBraidedSpansView = vi.fn<AuthzApi["recordBraidedSpansView"]>(async () => undefined);
  const app = createTraceAppHarness({
    protections: TraceViewerProtectionService.create({
      authz: createApiFixture<AuthzApi>({ hasPermission }, "authz"),
      projects: createApiFixture<ProjectApi>({ findWithTeam: async () => null }, "projects"),
      plans: createApiFixture<PlanProvider>({}, "plans"),
      dataPrivacy: createApiFixture<DataPrivacyApi>(
        {
          getResolvedForProjects: async ({ projectIds }) =>
            projectIds.includes(OWNER) ? ownerPolicy : PLATFORM_DEFAULT_DATA_PRIVACY,
        },
        "dataPrivacy",
      ),
      fallbackVisibilityDays: 30,
      logger: createTestLogger().logger,
    }),
    braidDirectory: {
      authz: createApiFixture<AuthzApi>(
        {
          hasPermission,
          recordBraidedSpansView,
          listBraids: async () => ({
            intoOtherProjects: [],
            fromOtherProjects: [
              {
                braidId: "braid-1",
                ownerProjectId: OWNER,
                readerProjectId: READER,
                where: CONDITION,
                fromMs: 0,
                expiresAtMs: null,
                createdByUserId: null,
                createdAtMs: 0,
              },
            ],
          }),
        },
        "braidAuthz",
      ),
      projects: createApiFixture<ProjectApi>(
        { findSummaryById: async () => ({ name: "Specialists", slug: "specialists" }) },
        "braidProjects",
      ),
    },
    spanCostSuggestions: createApiFixture<SpanCostSuggestionService>(
      { derive: async () => null },
      "spanCostSuggestions",
    ),
    traces: {
      spans: createApiFixture<TracesSpanReader>(
        {
          findSpanById: async ({ ownerProjectId }) => spanOf(ownerProjectId ?? READER),
          getSpanEvents: async () => [],
        },
        "spans",
      ),
    },
  });
  const authorization = braidedProof({ projectId: READER, braids: [{ owner: OWNER }] });
  const open = (ownerProjectId?: string) =>
    app.readSpanDetailForViewer({
      projectId: READER,
      authorization,
      traceId: "trace-1",
      spanId: "span-1",
      ownerProjectId,
      viewerUserId: "sam",
    });
  return { open, recordBraidedSpansView, authorization };
}

describe("TraceModule.readSpanDetailForViewer on a braided span", () => {
  describe("given the owner hides input and output from everyone", () => {
    /** @scenario "A braided span is redacted under its owning project's policy" */
    it("hides the owner's span content and shows the reader's own", async () => {
      const { open } = spanPanel({
        ownerPolicy: policyHiding(HIDDEN_FROM_EVERYONE),
        held: { [READER]: ADMIN },
      });

      const [braided, own] = await Promise.all([open(OWNER), open()]);

      expect(JSON.stringify([braided.input, braided.output])).not.toContain(OWNER);
      expect(own.input).toContain(`${READER} input`);
      expect(own.output).toContain(`${READER} output`);
    });
  });

  describe("given the owner shows span input only to its own admins", () => {
    const ownerPolicy = policyHiding(ADMINS_ONLY);

    /** @scenario "A viewer with no role on the owner project is outside its role-keyed audiences" */
    it("hides the input from an admin of the reader with no role on the owner", async () => {
      const { open } = spanPanel({ ownerPolicy, held: { [READER]: ADMIN } });

      const detail = await open(OWNER);

      expect(JSON.stringify(detail.input ?? null)).not.toContain(OWNER);
    });

    it("shows the input to an admin of the owner", async () => {
      const { open } = spanPanel({ ownerPolicy, held: { [READER]: ADMIN, [OWNER]: ADMIN } });

      const detail = await open(OWNER);

      expect(detail.input).toContain(`${OWNER} input`);
    });
  });

  describe("when the span panel describes the owner", () => {
    /** @scenario "Opening the owner project is offered only to someone who can open it" */
    it("offers the owner's slug only to a viewer who can read the owner", async () => {
      const ownerPolicy = policyHiding(HIDDEN_FROM_EVERYONE);
      const sam = spanPanel({ ownerPolicy, held: { [READER]: ADMIN } });
      const both = spanPanel({ ownerPolicy, held: { [READER]: ADMIN, [OWNER]: ["traces:view"] } });

      const [forSam, forReaderOfBoth] = await Promise.all([sam.open(OWNER), both.open(OWNER)]);

      expect(forSam.braid).toEqual({
        ownerProjectId: OWNER,
        ownerName: "Specialists",
        ownerProjectSlug: null,
        canOpenOwner: false,
        matchedConditions: [CONDITION],
        signedBy: null,
      });
      expect(forReaderOfBoth.braid).toMatchObject({
        ownerProjectSlug: "specialists",
        canOpenOwner: true,
      });
    });

    it("audits the read once, naming the reader and the owner", async () => {
      const { open, recordBraidedSpansView, authorization } = spanPanel({
        ownerPolicy: policyHiding(HIDDEN_FROM_EVERYONE),
        held: { [READER]: ADMIN },
      });

      await open(OWNER);
      const own = await open();

      expect(own.braid).toBeUndefined();
      expect(recordBraidedSpansView).toHaveBeenCalledTimes(1);
      expect(recordBraidedSpansView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });
  });
});
