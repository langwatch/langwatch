/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { hostServiceFakes } from "@langwatch/browser/testing";
import {
  ResourceLimitRowToken,
  UpgradeModalToken,
  type UpgradeModalActions,
} from "@langwatch/enterprise-licensing-client";
import { describe, expect, it } from "vitest";

import { licensingWeb } from "../licensing.web.ts";
import { useUpgradeModalStore } from "../model/upgrade-modal-store.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs licensing", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([hostServiceFakes(), licensingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(licensingWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the License component", async () => {
      const screen = licensingWeb.installation.screens["pages/settings/license"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    }, 30_000);
  });

  describe("when billing or organization reads the resourceLimitRow capability", () => {
    it("resolves the lent usage row", async () => {
      const lend = licensingWeb.installation.lends.find(
        ({ token }) => token.key === ResourceLimitRowToken.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    }, 30_000);
  });

  // specs/licensing/license-failure-modal.feature
  describe("when another module reads the upgrade modal actions", () => {
    /** @scenario Another module opens the upgrade modal through what licensing lends */
    it("opens the modal in limit, seats and restriction mode", () => {
      const lend = licensingWeb.installation.lends.find(
        ({ token }) => token.key === UpgradeModalToken.key,
      );
      const actions = lend && "value" in lend ? (lend.value as UpgradeModalActions) : undefined;
      const onConfirm = () => Promise.resolve();

      actions?.open("members", 5, 5);
      expect(useUpgradeModalStore.getState().variant?.mode).toBe("limit");
      actions?.openSeats({ organizationId: "org", currentSeats: 1, newSeats: 2, onConfirm });
      expect(useUpgradeModalStore.getState().variant?.mode).toBe("seats");
      actions?.openLiteMemberRestriction({ resource: "prompts" });
      expect(useUpgradeModalStore.getState().variant?.mode).toBe("liteMemberRestriction");
    });
  });
});
