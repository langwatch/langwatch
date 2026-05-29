import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE as SERVER_BODY,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE as SERVER_SUBJECT,
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE as SERVER_BLOCK_KIT,
  DEFAULT_SLACK_TEMPLATE as SERVER_SLACK,
} from "~/server/event-sourcing/outbox/templating/defaults";
import { TEMPLATE_VARIABLES as SERVER_VARIABLES } from "~/server/event-sourcing/outbox/templating/exampleContext";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
  TEMPLATE_VARIABLES,
  buildClientScaffold,
} from "../scaffold";

/**
 * The client `scaffold` module deliberately duplicates the static server
 * constants so the drawer can build its scaffold synchronously instead of
 * round-tripping through tRPC. These tests fail loudly if the two copies
 * drift — change one, change the other.
 */
describe("client scaffold mirrors the server constants", () => {
  it("uses the same default email subject template", () => {
    expect(DEFAULT_EMAIL_SUBJECT_TEMPLATE).toBe(SERVER_SUBJECT);
  });
  it("uses the same default email body template", () => {
    expect(DEFAULT_EMAIL_BODY_TEMPLATE).toBe(SERVER_BODY);
  });
  it("uses the same default Slack plain-text template", () => {
    expect(DEFAULT_SLACK_TEMPLATE).toBe(SERVER_SLACK);
  });
  it("uses the same default Slack Block Kit template", () => {
    expect(DEFAULT_SLACK_BLOCK_KIT_TEMPLATE).toBe(SERVER_BLOCK_KIT);
  });
  it("uses the same variable contract (paths + types + descriptions)", () => {
    expect(TEMPLATE_VARIABLES).toEqual(SERVER_VARIABLES);
  });
});

describe("buildClientScaffold", () => {
  it("returns defaults, variables, and an example shaped like a TemplateContext", () => {
    const scaffold = buildClientScaffold({ name: "Acme", slug: "acme" });
    expect(scaffold.defaults.emailSubject).toMatch(/Trigger/);
    expect(scaffold.variables.map((v) => v.path)).toContain("match.trace.url");
    const example = scaffold.example as {
      project: { slug: string };
      match: { trace: { url: string } } | null;
    };
    expect(example.project.slug).toBe("acme");
    expect(example.match?.trace.url).toMatch(/\/acme\/messages\/trace_/);
  });
});
