// Phase 0 product seeds written through the old image's own tRPC with a signed-in account, and
// phase 2's read-back of each through head's wire (specs/upgrade/upgrade-rehearsal.feature).
// Usage: node product.mjs seed|readback  (APP_BASE, SEED_EMAIL, SEED_PASSWORD, SEED_LABEL, OUT)
// readback also reads SEEDS (the seed run's JSON). Each kind is seeded or names why it was not.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createWire, findProjectId } from "../../migration-compat-smoke/smoke.mjs";

const SLACK_WEBHOOK = "https://hooks.slack.com/services/T0000000/B0000000/rehearsalseed";

/**
 * One entry per seeded kind: `create` writes it on the old image, `read` asks head for it and
 * `marker` is the text head's answer must contain. `unseedable` names why a kind has no seed.
 * A `bulk` kind is written ctx.perKind times; `create` and `marker` take its index `i`.
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
        retentionDays: 63,
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
        scoreOptions: {},
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
    kind: "dataset",
    bulk: true,
    create: ({ ctx, i }) => ({
      path: "dataset.upsert",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal dataset ${ctx.label} ${nth(i)}`,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "expected_output", type: "string" },
        ],
        datasetRecords: [
          { input: "alpha", expected_output: "a" },
          { input: "beta", expected_output: "b" },
          { input: "gamma", expected_output: "g" },
        ],
      },
    }),
    read: ({ ctx }) => ({ path: "dataset.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx, i }) => `rehearsal dataset ${ctx.label} ${nth(i)}`,
  },
  {
    kind: "evaluator",
    bulk: true,
    create: ({ ctx, i }) => ({
      path: "evaluators.create",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal evaluator ${ctx.label} ${nth(i)}`,
        type: "evaluator",
        config: {
          evaluatorType: "langevals/exact_match",
          settings: { caseSensitive: false },
        },
      },
    }),
    read: ({ ctx }) => ({ path: "evaluators.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx, i }) => `rehearsal evaluator ${ctx.label} ${nth(i)}`,
  },
  {
    kind: "prompt",
    bulk: true,
    create: ({ ctx, i }) => ({
      path: "prompts.create",
      input: {
        projectId: ctx.projectId,
        data: {
          scope: "PROJECT",
          handle: promptHandle({ ctx, i }),
          prompt: "rehearsal seed",
        },
      },
    }),
    read: ({ ctx }) => ({
      path: "prompts.getAllPromptsForProject",
      input: { projectId: ctx.projectId },
    }),
    marker: ({ ctx, i }) => promptHandle({ ctx, i }),
  },
  {
    kind: "monitor",
    bulk: true,
    create: ({ ctx, i }) => ({
      path: "monitors.create",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal monitor ${ctx.label} ${nth(i)}`,
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        sample: 1,
        executionMode: "ON_MESSAGE",
        evaluatorId: ctx.created?.evaluator?.[i]?.id,
      },
    }),
    read: ({ ctx }) => ({
      path: "monitors.getAllForProject",
      input: { projectId: ctx.projectId },
    }),
    marker: ({ ctx, i }) => `rehearsal monitor ${ctx.label} ${nth(i)}`,
  },
  {
    kind: "scenario",
    bulk: true,
    create: ({ ctx, i }) => ({
      path: "scenarios.create",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal scenario ${ctx.label} ${nth(i)}`,
        situation: "A customer asks for a refund.",
        criteria: [],
        labels: [],
      },
    }),
    read: ({ ctx }) => ({ path: "scenarios.getAll", input: { projectId: ctx.projectId } }),
    marker: ({ ctx, i }) => `rehearsal scenario ${ctx.label} ${nth(i)}`,
  },
  {
    kind: "suite",
    create: ({ ctx }) => ({
      path: "suites.create",
      input: {
        projectId: ctx.projectId,
        name: `rehearsal suite ${ctx.label}`,
        scenarioIds: [ctx.created?.scenario?.[0]?.id].filter(Boolean),
      },
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

/** Retries the org create while the old worker misses the api's read-your-writes window. */
async function initializeOrganization({ wire, ctx }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await wire.mutate({
        path: "onboarding.initializeOrganization",
        input: { orgName: `Rehearsal ${ctx.label}`, projectName: `rehearsal ${ctx.label}` },
      });
    } catch (error) {
      const message = String(error?.message ?? error);
      if (attempt >= 6 || !message.includes("authz_grant_not_confirmed")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}

async function prepare({ wire, ctx }) {
  await wire.signIn({ email: ctx.email, password: ctx.password });
  const created = await initializeOrganization({ wire, ctx });
  ctx.organizationId = created.organizationId;
  ctx.grantPaidPlan?.({ organizationId: ctx.organizationId }); // retention overrides refuse a free plan
  const organizations = await wire.query({ path: "organization.getAll", input: {} });
  ctx.projectId = findProjectId({ organizations, slug: created.projectSlug });
  if (!ctx.projectId) {
    ctx.projectId = organizations?.[0]?.teams?.[0]?.projects?.[0]?.id;
  }
  // Main's prompts.create refuses MODEL_NOT_CONFIGURED without a default model at some scope.
  await wire
    .mutate({
      path: "modelProvider.setRoleAssignmentForScope",
      input: {
        scopeType: "PROJECT",
        scopeId: ctx.projectId,
        role: "DEFAULT",
        model: "openai/gpt-5",
      },
    })
    .catch(() => {}); // a failure shows up as the prompt kind's own MODEL_NOT_CONFIGURED
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

/** A bulk kind's zero-padded index, so no marker is a prefix of another. */
export const nth = (i) => String(i).padStart(5, "0");

/** Lowercase handle for a bulk prompt; main's handle regex allows only [a-z0-9_-]. */
const promptHandle = ({ ctx, i }) =>
  `rehearsal-prompt-${ctx.label}-${nth(i)}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

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
    const total = entry.bulk ? (ctx.perKind ?? 1) : 1;
    let created = 0;
    let error = null;
    for (let i = 0; i < total; i++) {
      try {
        ((ctx.created ??= {})[entry.kind] ??= [])[i] = await wire.mutate(entry.create({ ctx, i }));
        created++;
      } catch (caught) {
        error ??= String(caught.message ?? caught);
      }
    }
    kinds.push(
      created > 0
        ? {
            kind: entry.kind,
            seeded: true,
            ...(entry.bulk && { created, failed: total - created }),
          }
        : { kind: entry.kind, seeded: false, reason: error },
    );
  }
  const {
    email: _email,
    password: _password,
    licenceKey: _key,
    created: _created,
    ...context
  } = ctx;
  return { context, kinds };
}

/** Asks head for every kind the seed wrote and records whether its marker came back. */
export async function readBack({ wire, ctx, seeds }) {
  await wire.signIn({ email: ctx.email, password: ctx.password });
  const seeded = { ...ctx, ...seeds.context };
  const kinds = [];
  for (const seed of seeds.kinds.filter((each) => each.seeded)) {
    const entry = PRODUCT_KINDS.find((each) => each.kind === seed.kind);
    try {
      const answer = await wire.query(entry.read({ ctx: seeded }));
      if (!entry.bulk) {
        kinds.push({
          kind: seed.kind,
          found: holdsMarker({ answer, marker: entry.marker({ ctx: seeded }) }),
        });
        continue;
      }
      let foundCount = 0;
      for (let i = 0; i < seed.created + seed.failed; i++) {
        if (holdsMarker({ answer, marker: entry.marker({ ctx: seeded, i }) })) foundCount++;
      }
      kinds.push({
        kind: seed.kind,
        found: foundCount >= seed.created,
        foundCount,
        created: seed.created,
      });
    } catch (error) {
      kinds.push({ kind: seed.kind, found: false, error: String(error.message ?? error) });
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
    perKind: Number(process.env.SEED_PER_KIND ?? 1),
  };
  // SaaS has no headless checkout, so an ACTIVE paid subscription is written straight to Postgres.
  if (process.env.DATABASE_URL) {
    ctx.grantPaidPlan = ({ organizationId }) =>
      execFileSync(
        "psql",
        [
          process.env.DATABASE_URL.split("?")[0],
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          `org=${organizationId}`,
        ],
        {
          input: `INSERT INTO "Subscription" (id, "organizationId", plan, status) VALUES ('rehearsal_sub_' || md5(random()::text), :'org', 'LAUNCH', 'ACTIVE');`,
        },
      );
  }
  // Head shares the old image's BASE_HOST, so its auth trusts only that origin.
  const wire = createWire({ appBase: process.env.APP_BASE, origin: process.env.APP_ORIGIN });
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
