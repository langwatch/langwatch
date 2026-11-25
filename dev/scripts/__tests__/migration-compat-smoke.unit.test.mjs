import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWire,
  findProjectId,
  runSmoke,
  sessionCookieFrom,
  smokeSteps,
} from "../migration-compat-smoke/smoke.mjs";

const APP = "http://localhost:5560";

/** A fake old image: answers each route the smoke speaks, and records the calls. */
function fakeImage({ refuse } = {}) {
  const calls = [];
  const trpc = (json) => ({ result: { data: { json } } });
  const answers = {
    "/api/auth/sign-in/email": () => ({ token: "t" }),
    "/api/auth/get-session": () => ({ user: { id: "user_1" } }),
    "/api/trpc/onboarding.initializeOrganization": () =>
      trpc({ organizationId: "org_1", teamId: "team_1" }),
    "/api/trpc/project.create": () => trpc({ success: true, projectSlug: "compat-second" }),
    "/api/trpc/organization.getAll": () =>
      trpc([{ teams: [{ projects: [{ id: "project_1", slug: "compat-second" }] }] }]),
    "/api/trpc/project.getProjectAPIKey": () => trpc({ apiKey: "sk-lw-compat" }),
    "/api/collector": () => ({ message: "Trace received successfully." }),
    "/api/traces/search": () => ({ traces: [], pagination: { totalHits: 0 } }),
    "/api/trpc/annotation.create": () => trpc({ id: "annotation_1" }),
    "/api/trpc/annotation.getByTraceId": () => trpc([{ id: "annotation_1" }]),
    "/api/trpc/slackIntegration.create": () => trpc({ id: "slack_1" }),
    "/api/trpc/slackIntegration.delete": () => trpc({ deleted: true }),
    "/api/trpc/connectedBilling.get": () => trpc({ contract: null }),
    "/api/trpc/roleBinding.create": () => trpc({ id: "binding_1" }),
    "/api/trpc/roleBinding.delete": () => trpc({ success: true }),
  };
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push({ pathname, init });
    if (pathname === refuse) {
      return new Response(
        JSON.stringify({ error: { json: { message: "column does not exist" } } }),
        {
          status: 500,
        },
      );
    }
    const answer = answers[pathname];
    if (!answer) return new Response("not found", { status: 404 });
    const headers = new Headers();
    if (pathname === "/api/auth/sign-in/email") {
      headers.append("set-cookie", "better-auth.session_token=abc.def; Path=/; HttpOnly");
    }
    return new Response(JSON.stringify(answer()), { status: 200, headers });
  };
  return { calls, fetchImpl };
}

const context = () => ({ label: "floor", email: "compat-floor@example.com", password: "pw" });

void describe("the smoke against an old image", () => {
  /** @scenario "The old images pass an HTTP smoke on the schema head migrated" */
  void it("signs in, writes and reads through every surface the plan names, in order", async () => {
    const image = fakeImage();
    const wire = createWire({ appBase: APP, fetchImpl: image.fetchImpl });
    const { passed, failed } = await runSmoke({
      steps: smokeSteps(),
      wire,
      ctx: context(),
      log: () => {},
    });
    assert.equal(failed, null);
    assert.deepEqual(passed, [
      "sign in",
      "create the organisation",
      "create a project",
      "ingest a trace",
      "list traces",
      "annotate",
      "delete a Slack connection",
      "open the connected-billing overview",
      "revoke a binding",
    ]);
    const signedIn = image.calls.filter((call) => call.pathname.startsWith("/api/trpc/"));
    assert.ok(
      signedIn.every((call) => call.init.headers.Cookie === "better-auth.session_token=abc.def"),
    );
    const keyed = image.calls.filter((call) =>
      ["/api/collector", "/api/traces/search"].includes(call.pathname),
    );
    assert.ok(keyed.every((call) => call.init.headers["X-Auth-Token"] === "sk-lw-compat"));
  });

  /** @scenario "A smoke step the old image refuses fails the job and names the step" */
  void it("stops at the first refusal and names the step and the answer", async () => {
    const image = fakeImage({ refuse: "/api/trpc/annotation.create" });
    const wire = createWire({ appBase: APP, fetchImpl: image.fetchImpl });
    const { passed, failed } = await runSmoke({
      steps: smokeSteps(),
      wire,
      ctx: context(),
      log: () => {},
    });
    assert.equal(failed?.name, "annotate");
    assert.match(
      failed.detail,
      /mutation annotation\.create answered 500: .*column does not exist/,
    );
    assert.equal(passed.at(-1), "list traces");
    assert.ok(!image.calls.some((call) => call.pathname.startsWith("/api/trpc/slackIntegration")));
  });

  void it("reads a tRPC error envelope on a 200 as a refusal", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { json: { code: -32603 } } }), { status: 200 });
    const wire = createWire({ appBase: APP, fetchImpl });
    await assert.rejects(wire.query({ path: "connectedBilling.get", input: {} }), /answered 200/);
  });
});

void describe("reading the old image's answers", () => {
  void it("takes the session cookie with or without the secure prefix", () => {
    assert.equal(
      sessionCookieFrom({
        setCookies: ["other=1", "__Secure-better-auth.session_token=x.y; Path=/"],
      }),
      "__Secure-better-auth.session_token=x.y",
    );
    assert.equal(sessionCookieFrom({ setCookies: ["other=1"] }), null);
  });

  void it("finds a project by slug in any team", () => {
    const organizations = [
      { teams: [{ projects: [] }, { projects: [{ id: "p2", slug: "two" }] }] },
    ];
    assert.equal(findProjectId({ organizations, slug: "two" }), "p2");
    assert.equal(findProjectId({ organizations, slug: "three" }), null);
  });
});
