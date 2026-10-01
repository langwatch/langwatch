/**
 * The read-hint map the kernel collects from installed contracts, and the one registration it
 * makes. Spec: packages/api/specs/read-hints.feature.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../src/contract/trpc-contract.ts";
import { installReadHints, readHintsOf, type EventingHost } from "../src/module-eventing.ts";

const organization = defineTrpcContract("organization")
  .query("getScopeGraph", {
    invalidatedBy: [
      { event: "lw.project.created", scope: "organizationId" },
      "lw.authz.grant.revoked",
    ],
  })
  .withInput(z.object({}))
  .withOutput(z.unknown())
  .query("getAll")
  .withInput(z.object({}))
  .withOutput(z.unknown())
  .build();

const project = defineTrpcContract("project")
  .query("getAll", { invalidatedBy: ["lw.project.created"] })
  .withInput(z.object({}))
  .withOutput(z.unknown())
  .build();

function fakeEventing() {
  const registered: unknown[] = [];
  const asked: unknown[] = [];
  const host: EventingHost = {
    participation: "produce",
    processStore: undefined,
    register: (definition) => void registered.push(definition),
    readHintPipeline: (hinted) => {
      asked.push(hinted);
      return { name: "read_hints" };
    },
  };
  return { host, registered, asked };
}

const trpcTransport = {
  protocol: "trpc" as const,
  namespace: "organization",
  router: () => ({}),
  contract: organization,
};
const restTransport = { protocol: "rest" as const, namespace: "organizations", router: () => ({}) };

describe("readHintsOf", () => {
  /** @scenario "Every read naming an event is found from that event" */
  it("maps each named event to every read naming it, with its scope", () => {
    const hinted = readHintsOf({ contracts: [organization, project] });

    expect(hinted.get("lw.project.created")).toEqual([
      { path: "organization.getScopeGraph", scope: "organizationId" },
      { path: "project.getAll" },
    ]);
    expect(hinted.get("lw.authz.grant.revoked")).toEqual([{ path: "organization.getScopeGraph" }]);
    expect(hinted.has("lw.organization.signed_up")).toBe(false);
  });
});

describe("installReadHints", () => {
  /** @scenario "Every read naming an event is found from that event" */
  it("registers one subscriber built from the installed tRPC contracts", () => {
    const { host, registered, asked } = fakeEventing();

    installReadHints({
      eventing: host,
      declared: [
        {
          feature: "organization",
          transports: [trpcTransport, restTransport],
          provided: () => ({}),
          facts: [],
        },
      ],
    });

    expect(asked).toEqual([readHintsOf({ contracts: [organization] })]);
    expect(registered).toEqual([{ name: "read_hints" }]);
  });

  it("registers nothing when no installed read names an event", () => {
    const { host, registered, asked } = fakeEventing();

    installReadHints({
      eventing: host,
      declared: [
        { feature: "rest-only", transports: [restTransport], provided: () => ({}), facts: [] },
      ],
    });

    expect(asked).toEqual([]);
    expect(registered).toEqual([]);
  });

  it("registers nothing on a runtime that cannot publish hints", () => {
    const { host, registered } = fakeEventing();
    installReadHints({
      eventing: {
        participation: host.participation,
        processStore: undefined,
        register: (definition) => host.register(definition),
      },
      declared: [
        { feature: "organization", transports: [trpcTransport], provided: () => ({}), facts: [] },
      ],
    });

    expect(registered).toEqual([]);
  });
});
