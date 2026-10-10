/**
 * @vitest-environment jsdom
 * A gateway screen asks its own host for a permission, and reads what the legacy scope hook read.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 4b).
 */
import {
  createUiScopeHost,
  UiScopeHostProvider,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GatewayHostProvider, useGatewayHost } from "../../model/gateway-host.ts";
import { FakeGatewayHost } from "../../testing.tsx";

/** The permissions the gateway screens gate their controls on. */
const ASKED = ["virtualKeys:create", "gatewayBudgets:update", "routingPolicies:manage"];

function Probe() {
  const host = useGatewayHost();
  return (
    <>
      <output aria-label="migrated">{ASKED.map((p) => host.hasPermission(p)).join()}</output>
    </>
  );
}

const renderFor = (grants: readonly string[]) =>
  render(
    <UiScopeHostProvider
      value={createUiScopeHost({
        project: () => ({ id: "proj_1", slug: "acme", name: "Acme" }),
        organization: () => ({ id: "org_1" }),
        team: () => ({ id: "team_1" }),
      })}
    >
      <GatewayHostProvider value={FakeGatewayHost.create({ permissions: grants })}>
        <Probe />
      </GatewayHostProvider>
    </UiScopeHostProvider>,
  );

afterEach(cleanup);

describe("given a signed-in reader whose role grants some permissions and not others", () => {
  describe("when a migrated gateway screen reads a permission from the gateway host", () => {
    /** @scenario "A migrated screen answers a signed-in reader the same as before" */
    it.each([
      [
        "held",
        ["virtualKeys:create", "gatewayBudgets:update", "routingPolicies:manage"],
        "true,true,true",
      ],
      ["partly held", ["virtualKeys:create"], "true,false,false"],
      ["not held", [], "false,false,false"],
    ])("reads a %s permission as the legacy scope hook did", (_label, grants, expected) => {
      renderFor(grants);
      expect(screen.getByLabelText("migrated").textContent).toBe(expected);
    });
  });
});
