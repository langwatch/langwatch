// @vitest-environment jsdom
/**
 * The secret mount answers `projectSwitcher()` from project's token lend, and
 * null where none: modules/project/specs/project-switcher-lend.feature.
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { ProjectSwitcherToken } from "@langwatch/project-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSecretHost } from "../../model/secret-host.ts";
import SecretHostMount from "../secret-host-mount.tsx";

const projectLendsASwitcher = uiDeclarations([
  {
    name: "project",
    installation: {
      capabilities: {},
      lends: [
        {
          token: ProjectSwitcherToken,
          load: async () => ({ default: () => <button>Switch project</button> }),
        },
      ],
    },
  },
]);

class ProjectInScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }
}

function renderMounted({ declarations }: { declarations?: UiDeclarations }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    scope: new ProjectInScope(),
    ...(declarations ? { declarations } : {}),
  };
  return render(
    <UiCapabilityContextProvider value={capabilities}>
      <SecretHostMount>
        <SwitcherReader />
      </SecretHostMount>
    </UiCapabilityContextProvider>,
  );
}

/** Stands in for the secrets screen's header: renders whatever the host answers. */
function SwitcherReader() {
  return <div data-testid="header">{useSecretHost().projectSwitcher()}</div>;
}

afterEach(cleanup);

describe("given the secret host mounted above the secrets screen", () => {
  describe("when project lends a switcher", () => {
    /** @scenario "A page outside the navigation shell draws project's lent switcher" */
    it("answers it, drawn in the header", async () => {
      renderMounted({ declarations: projectLendsASwitcher });

      expect(await screen.findByRole("button", { name: "Switch project" })).toBeTruthy();
    });
  });

  describe("when no module lends a switcher", () => {
    /** @scenario "No module lends a switcher" */
    it("answers nothing", () => {
      renderMounted({});

      expect(screen.getByTestId("header").childElementCount).toBe(0);
    });
  });
});
