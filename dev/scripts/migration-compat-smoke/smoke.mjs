// The HTTP smoke an old image runs on head's migrated schema: the first deploy
// and a rollback put exactly that pair in production (specs/ci/migration-compat.feature).
// It speaks the old image's public wire only, so it holds for 3.20.1 and main.
// Usage: node smoke.mjs  (APP_BASE, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_LABEL)

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const SLACK_WEBHOOK = "https://hooks.slack.com/services/T0000000/B0000000/compatsmoke";

/** The better-auth session cookie among a response's Set-Cookie values. */
export function sessionCookieFrom({ setCookies }) {
  for (const value of setCookies) {
    const match = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(value);
    if (match) return match[0];
  }
  return null;
}

/** The id of the project with this slug, anywhere in organization.getAll's answer. */
export function findProjectId({ organizations, slug }) {
  for (const organization of organizations ?? []) {
    for (const team of organization.teams ?? []) {
      const project = (team.projects ?? []).find((each) => each.slug === slug);
      if (project) return project.id;
    }
  }
  return null;
}

/** Reads one HTTP answer, refusing a status or a tRPC error envelope. */
async function answerOf({ what, response }) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || body?.error) {
    throw new Error(`${what} answered ${response.status}: ${text.slice(0, 600)}`);
  }
  return body;
}

/** The old image's wire: tRPC with superjson envelopes, REST with a project key. */
export function createWire({ appBase, fetchImpl = fetch }) {
  const state = { cookie: null };
  const headers = () => ({
    "Content-Type": "application/json",
    Origin: appBase,
    ...(state.cookie ? { Cookie: state.cookie } : {}),
  });
  return {
    state,
    async signIn({ email, password }) {
      const response = await fetchImpl(`${appBase}/api/auth/sign-in/email`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password }),
      });
      await answerOf({ what: "POST /api/auth/sign-in/email", response });
      state.cookie = sessionCookieFrom({ setCookies: response.headers.getSetCookie() });
      if (!state.cookie) throw new Error("the sign-in set no better-auth session cookie");
    },
    async session() {
      const response = await fetchImpl(`${appBase}/api/auth/get-session`, { headers: headers() });
      return answerOf({ what: "GET /api/auth/get-session", response });
    },
    async query({ path, input }) {
      const encoded = encodeURIComponent(JSON.stringify({ json: input }));
      const response = await fetchImpl(`${appBase}/api/trpc/${path}?input=${encoded}`, {
        headers: headers(),
      });
      return (await answerOf({ what: `query ${path}`, response })).result.data.json;
    },
    async mutate({ path, input }) {
      const response = await fetchImpl(`${appBase}/api/trpc/${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ json: input }),
      });
      return (await answerOf({ what: `mutation ${path}`, response })).result.data.json;
    },
    async rest({ method, path, apiKey, body }) {
      const response = await fetchImpl(`${appBase}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Auth-Token": apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return answerOf({ what: `${method} ${path}`, response });
    },
  };
}

/** The steps, in order; each reads and writes the context the earlier ones left. */
export function smokeSteps() {
  return [
    {
      name: "sign in",
      run: async ({ wire, ctx }) => {
        await wire.signIn({ email: ctx.email, password: ctx.password });
        const session = await wire.session();
        ctx.userId = session?.user?.id;
        if (!ctx.userId) throw new Error("the session names no user");
      },
    },
    {
      name: "create the organisation",
      run: async ({ wire, ctx }) => {
        const created = await wire.mutate({
          path: "onboarding.initializeOrganization",
          input: { orgName: `Compat ${ctx.label}`, projectName: `compat ${ctx.label} first` },
        });
        ctx.organizationId = created.organizationId;
        ctx.teamId = created.teamId;
        if (!ctx.organizationId || !ctx.teamId)
          throw new Error("no organisation or team came back");
      },
    },
    {
      name: "create a project",
      run: async ({ wire, ctx }) => {
        const created = await wire.mutate({
          path: "project.create",
          input: {
            organizationId: ctx.organizationId,
            teamId: ctx.teamId,
            name: `compat ${ctx.label} second`,
            language: "other",
            framework: "other",
          },
        });
        const organizations = await wire.query({ path: "organization.getAll", input: {} });
        ctx.projectId = findProjectId({ organizations, slug: created.projectSlug });
        if (!ctx.projectId) throw new Error(`project ${created.projectSlug} is not listed`);
        const { apiKey } = await wire.query({
          path: "project.getProjectAPIKey",
          input: { projectId: ctx.projectId },
        });
        ctx.apiKey = apiKey;
        if (!ctx.apiKey) throw new Error("the project has no API key");
      },
    },
    {
      name: "ingest a trace",
      run: async ({ wire, ctx }) => {
        const now = Date.now();
        ctx.traceId = `trace_compat_${randomUUID()}`;
        await wire.rest({
          method: "POST",
          path: "/api/collector",
          apiKey: ctx.apiKey,
          body: {
            trace_id: ctx.traceId,
            spans: [
              {
                type: "span",
                span_id: `span_${randomUUID()}`,
                trace_id: ctx.traceId,
                name: "compat smoke",
                input: { type: "text", value: "is the old code at home here" },
                output: { type: "text", value: "yes" },
                timestamps: { started_at: now - 1000, finished_at: now },
              },
            ],
          },
        });
      },
    },
    {
      name: "list traces",
      run: async ({ wire, ctx }) => {
        const now = Date.now();
        const found = await wire.rest({
          method: "POST",
          path: "/api/traces/search",
          apiKey: ctx.apiKey,
          body: { startDate: now - 86_400_000, endDate: now + 3_600_000 },
        });
        if (!Array.isArray(found?.traces))
          throw new Error("the search answered without a traces list");
      },
    },
    {
      name: "annotate",
      run: async ({ wire, ctx }) => {
        await wire.mutate({
          path: "annotation.create",
          input: {
            projectId: ctx.projectId,
            traceId: ctx.traceId,
            comment: "compat smoke",
            isThumbsUp: true,
            scoreOptions: {},
          },
        });
        const annotations = await wire.query({
          path: "annotation.getByTraceId",
          input: { projectId: ctx.projectId, traceId: ctx.traceId },
        });
        if (!Array.isArray(annotations) || annotations.length === 0) {
          throw new Error("the annotation does not read back");
        }
      },
    },
    {
      name: "delete a Slack connection",
      run: async ({ wire, ctx }) => {
        const connection = await wire.mutate({
          path: "slackIntegration.create",
          input: {
            projectId: ctx.projectId,
            name: `compat ${ctx.label}`,
            kind: "INCOMING_WEBHOOK",
            scopeType: "PROJECT",
            scopeId: ctx.projectId,
            secret: SLACK_WEBHOOK,
          },
        });
        await wire.mutate({
          path: "slackIntegration.delete",
          input: { projectId: ctx.projectId, id: connection.id },
        });
      },
    },
    {
      name: "open the connected-billing overview",
      run: async ({ wire, ctx }) => {
        await wire.query({
          path: "connectedBilling.get",
          input: { organizationId: ctx.organizationId },
        });
      },
    },
    {
      name: "revoke a binding",
      run: async ({ wire, ctx }) => {
        const binding = await wire.mutate({
          path: "roleBinding.create",
          input: {
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: "VIEWER",
            scopeType: "PROJECT",
            scopeId: ctx.projectId,
          },
        });
        await wire.mutate({
          path: "roleBinding.delete",
          input: { organizationId: ctx.organizationId, bindingId: binding.id },
        });
      },
    },
  ];
}

/** Runs the steps in order and stops at the first failure, which it names. */
export async function runSmoke({ steps, wire, ctx, log = console.log }) {
  const passed = [];
  for (const step of steps) {
    try {
      await step.run({ wire, ctx });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { passed, failed: { name: step.name, detail } };
    }
    passed.push(step.name);
    log(`ok   ${ctx.label}: ${step.name}`);
  }
  return { passed, failed: null };
}

async function main() {
  const { APP_BASE, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_LABEL } = process.env;
  if (!APP_BASE || !SMOKE_EMAIL || !SMOKE_PASSWORD || !SMOKE_LABEL) {
    console.error("APP_BASE, SMOKE_EMAIL, SMOKE_PASSWORD and SMOKE_LABEL are required");
    process.exit(2);
  }
  const ctx = { label: SMOKE_LABEL, email: SMOKE_EMAIL, password: SMOKE_PASSWORD };
  const wire = createWire({ appBase: APP_BASE });
  const { failed } = await runSmoke({ steps: smokeSteps(), wire, ctx });
  if (failed) {
    console.log(
      `::error title=migration-compat::${SMOKE_LABEL} failed "${failed.name}" on head's schema`,
    );
    console.log(failed.detail);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
