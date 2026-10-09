/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { hostServiceFakes } from "@langwatch/browser/testing";
import { GithubConnectPopupToken } from "@langwatch/github-client";
import { describe, expect, it } from "vitest";

import { githubWeb } from "../github.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs github", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([hostServiceFakes(), githubWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(githubWeb);
    });
  });

  describe("when a reader looks up the connect popup token from github's client", () => {
    /** @scenario github lends its install popup by its client token */
    it("lends the popup hooks as an eager value", () => {
      const lend = githubWeb.installation.lends.find(
        ({ token }) => token.key === GithubConnectPopupToken.key,
      );

      expect(lend && "value" in lend ? lend.value : undefined).toBeTypeOf("object");
    });
  });
});
