// Phase 0 product seeds written through the old image's own tRPC with a signed-in account, and
// phase 2's read-back of each through head's wire (specs/upgrade/upgrade-rehearsal.feature).
// Usage: node product.mjs seed|readback  (APP_BASE, SEED_EMAIL, SEED_PASSWORD, SEED_LABEL, OUT)
// readback also reads SEEDS (the seed run's JSON). Each kind is seeded or names why it was not.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createWire, findProjectId } from "../../migration-compat-smoke/smoke.mjs";

const SLACK_WEBHOOK = "https://hooks.slack.com/services/T0000000/B0000000/rehearsalseed";

/**
 * One entry per seeded kind: `create` writes it on the old image, `read` asks head for it and
 * `marker` is the text head's answer must contain. `unseedable` names why a kind has no seed.
 */
export const PRODUCT_KINDS = [
  {
    kind: "privacy",
    create: ({ ctx }) => ({
      path: "dataPrivacy.setForScope",
      input: {
        projectId: ctx.projectId,
        scope: { scopeType: "PROJECT", scopeId: ctx.projectId },
        personalOnly: false,
        config: {},
      },
    }),
    read: ({ ctx }) => ({ path: "dataPrivacy.getSnapshot", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => ctx.projectId,
  },
  {
    kind: "retention",
    create: ({ ctx }) => ({
      path: "dataRetention.setForScope",
      input: {
        projectId: ctx.projectId,
        scope: { scopeType: "PROJECT", scopeId: ctx.projectId },
        category: "traces",
        retentionDays: 45,
      },
    }),
    read: ({ ctx }) => ({ path: "dataRetention.getRules", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => ctx.projectId,
  },
  {
    kind: "annotation",
    create: ({ ctx }) => ({
      path: "annotation.create",
      input: {
        projectId: ctx.projectId,
        traceId: ctx.traceId,
        comment: `rehearsal ${ctx.label}`,
        isThumbsUp: true,
      },
    }),
    read: ({ ctx }) => ({
      path: "annotation.getByTraceId",
      input: { projectId: ctx.projectId, traceId: ctx.traceId },
    }),
    marker: ({ ctx }) => `rehearsal ${ctx.label}`,
  },
  {
    kind: "workflow",
    create: ({ ctx }) => ({
      path: "workflow.create",
      input: {
        projectId: ctx.projectId,
        commitMessage: "rehearsal seed",
        dsl: {
          spec_version: "1.4",
          name: `rehearsal workflow ${ctx.label}`,
          icon: "🧪",
          description: "upgrade rehearsal seed",
          version: "1.0",
          default_llm: { model: "openai/gpt-5" },
          template_adapter: "default",
          enable_tracing: true,
          nodes: [],
          edges: [],
          state: {},
        },
      },
    }),
    read: ({ ctx }) => ({ path: "workflow.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => `rehearsal workflow ${ctx.label}`,
  },
  {
    kind: "slack",
    create: ({ ctx }) => ({
      path: "slackIntegration.create",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal slack ${ctx.label}`,
        kind: "INCOMING_WEBHOOK",
        scopeType: "PROJECT",
        scopeId: ctx.projectId,
        secret: SLACK_WEBHOOK,
      },
    }),
    read: ({ ctx }) => ({ path: "slackIntegration.list", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => `rehearsal slack ${ctx.label}`,
  },
  {
    kind: "report",
    create: ({ ctx }) => ({
      path: "dashboards.create",
      input: { projectId: ctx.projectId, name: `rehearsal report ${ctx.label}` },
    }),
    read: ({ ctx }) => ({ path: "dashboards.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => `rehearsal report ${ctx.label}`,
  },
  {
    kind: "suite",
    create: ({ ctx }) => ({
      path: "suites.create",
      input: { projectId: ctx.projectId, name: `rehearsal suite ${ctx.label}` },
    }),
    read: ({ ctx }) => ({ path: "suites.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx }) => `rehearsal suite ${ctx.label}`,
  },
  {
    kind: "licence",
    unseedable: ({ ctx }) =>
      ctx.licenceKey ? null : "no REHEARSAL_LICENSE_KEY: the old image accepts only a signed key",
    create: ({ ctx }) => ({
      path: "license.upload",
      input: { organizationId: ctx.organizationId, licenseKey: ctx.licenceKey },
    }),
    read: ({ ctx }) => ({
      path: "license.getStatus",
      input: { organizationId: ctx.organizationId },
    }),
    marker: () => null,
  },
  {
    kind: "sso",
    unseedable: () =>
      "no headless seed: an SSO connection needs a licence and a live IdP registration",
  },
  {
    kind: "coding-assistant",
    unseedable: () => "no headless seed: the old image's codingAgents router only reads",
  },
];

/** Whether head's answer holds the seeded row: its marker, or any answer when it has none. */
export function holdsMarker({ answer, marker }) {
  if (answer === undefined || answer === null) return false;
  return marker === null || JSON.stringify(answer).includes(marker);
}

async function prepare({ wire, ctx }) {
  await wire.signIn({ email: ctx.email, password: ctx.password });
  const created = await wire.mutate({
    path: "onboarding.initializeOrganization",
    input: { orgName: `Rehearsal ${ctx.label}`, projectName: `rehearsal ${ctx.label}` },
  });
  ctx.organizationId = created.organizationId;
  const organizations = await wire.query({ path: "organization.getAll", input: {} });
  ctx.projectId = findProjectId({ organizations, slug: created.projectSlug });
  if (!ctx.projectId) {
    ctx.projectId = organizations?.[0]?.teams?.[0]?.projects?.[0]?.id;
  }
  const { apiKey } = await wire.query({
    path: "project.getProjectAPIKey",
    input: { projectId: ctx.projectId },
  });
  ctx.traceId = `rehearsal-${randomUUID()}`;
  await wire.rest({
    method: "POST",
    path: "/api/collector",
    apiKey,
    body: {
      trace_id: ctx.traceId,
      spans: [
        {
          type: "span",
          span_id: `span-${randomUUID()}`,
          name: "rehearsal seed",
          input: { type: "text", value: "seeded before the upgrade" },
          timestamps: { started_at: Date.now() - 1000, finished_at: Date.now() },
        },
      ],
    },
  });
}

/** Writes every seedable kind on the old image; one failure never stops the others. */
export async function seedProducts({ wire, ctx }) {
  await prepare({ wire, ctx });
  const kinds = [];
  for (const entry of PRODUCT_KINDS) {
    const reason = entry.unseedable?.({ ctx }) ?? null;
    if (reason) {
      kinds.push({ kind: entry.kind, seeded: false, reason });
      continue;
    }
    try {
      await wire.mutate(entry.create({ ctx }));
      kinds.push({ kind: entry.kind, seeded: true });
    } catch (error) {
      kinds.push({ kind: entry.kind, seeded: false, reason: String(error.message ?? error) });
    }
  }
  const { email: _email, password: _password, licenceKey: _key, ...context } = ctx;
  return { context, kinds };
}

/** Asks head for every kind the seed wrote and records whether its marker came back. */
export async function readBack({ wire, ctx, seeds }) {
  await wire.signIn({ email: ctx.email, password: ctx.password });
  const seeded = { ...ctx, ...seeds.context };
  const kinds = [];
  for (const { kind } of seeds.kinds.filter((each) => each.seeded)) {
    const entry = PRODUCT_KINDS.find((each) => each.kind === kind);
    try {
      const answer = await wire.query(entry.read({ ctx: seeded }));
      kinds.push({ kind, found: holdsMarker({ answer, marker: entry.marker({ ctx: seeded }) }) });
    } catch (error) {
      kinds.push({ kind, found: false, error: String(error.message ?? error) });
    }
  }
  return { kinds };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = process.argv[2];
  const ctx = {
    email: process.env.SEED_EMAIL,
    password: process.env.SEED_PASSWORD,
    label: process.env.SEED_LABEL ?? "rehearsal",
    licenceKey: process.env.REHEARSAL_LICENSE_KEY,
  };
  const wire = createWire({ appBase: process.env.APP_BASE });
  const result =
    mode === "seed"
      ? await seedProducts({ wire, ctx })
      : await readBack({
          wire,
          ctx,
          seeds: JSON.parse(readFileSync(process.env.SEEDS, "utf8")),
        });
  writeFileSync(process.env.OUT, `${JSON.stringify(result, null, 2)}\n`);
}
