/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentPrivacy } from "~/server/api/routers/tracesV2.schemas";
import {
  ContentPrivacyMarkers,
  PiiIncompleteNotice,
} from "../ContentPrivacyMarkers";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: () => true }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const visible = { state: "visible" as const, visibleTo: null };

function privacy(overrides: Partial<ContentPrivacy> = {}): ContentPrivacy {
  return {
    input: { ...visible },
    output: { ...visible },
    system: { ...visible },
    tools: { ...visible },
    ...overrides,
  };
}

describe("ContentPrivacyMarkers", () => {
  afterEach(cleanup);

  describe("when all content is plainly captured and visible", () => {
    it("renders nothing", () => {
      const { container } = render(
        <Wrapper>
          <ContentPrivacyMarkers privacy={privacy()} />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("when a category was dropped", () => {
    it("marks it as not stored", () => {
      const { container } = render(
        <Wrapper>
          <ContentPrivacyMarkers
            privacy={privacy({ system: { state: "dropped", visibleTo: null } })}
            categories={["system", "tools"]}
          />
        </Wrapper>,
      );
      expect(container.textContent).toContain("System instructions not stored");
    });
  });

  describe("when a category is restricted and hidden from the viewer", () => {
    it("marks it hidden and names the audience that can see it", () => {
      const { container } = render(
        <Wrapper>
          <ContentPrivacyMarkers
            privacy={privacy({
              tools: { state: "restricted", visibleTo: "Admins" },
            })}
            categories={["system", "tools"]}
          />
        </Wrapper>,
      );
      expect(container.textContent).toContain(
        "Tool calls hidden (visible to Admins)",
      );
    });
  });

  describe("when a category is restricted but visible to the viewer", () => {
    it("tells the viewer the content is restricted to that audience", () => {
      const { container } = render(
        <Wrapper>
          <ContentPrivacyMarkers
            privacy={privacy({
              input: { state: "visible", visibleTo: "Admins" },
            })}
            categories={["input", "output"]}
          />
        </Wrapper>,
      );
      expect(container.textContent).toContain("Input visible to Admins");
    });
  });

  describe("when skipRestricted is set (input/output handled inline elsewhere)", () => {
    it("does not render the restricted-hidden marker", () => {
      const { container } = render(
        <Wrapper>
          <ContentPrivacyMarkers
            privacy={privacy({
              input: { state: "restricted", visibleTo: "Admins" },
            })}
            categories={["input", "output"]}
            skipRestricted
          />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });
});

describe("PiiIncompleteNotice", () => {
  afterEach(cleanup);

  describe("when strict redaction completed", () => {
    it("renders nothing", () => {
      const { container } = render(
        <Wrapper>
          <PiiIncompleteNotice incomplete={false} />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("when strict redaction did not complete", () => {
    it("warns that names and locations may remain", () => {
      const { container } = render(
        <Wrapper>
          <PiiIncompleteNotice incomplete />
        </Wrapper>,
      );
      expect(container.textContent).toContain(
        "may still contain names or locations",
      );
    });
  });
});
