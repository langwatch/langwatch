/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  permissionDecisionRecord,
  principalOfSession,
} from "~/server/app-layer/authz/decision-record";
import { resolveSessionPrincipal } from "~/server/app-layer/identity/impersonation-claims";
import { ImpersonationBanner } from "../ImpersonationBanner";

/**
 * The banner and the way out, driven by the session's `{actor, subject}`
 * claims rather than by the legacy impersonation payload (D06).
 *
 * `specs/auth/impersonation-banner.feature` and
 * `specs/ops/dejaview-impersonation-access.feature` still own this behaviour;
 * what this file proves is that the behaviour survived the mechanism swap —
 * the claims resolve to the same pair the banner has always rendered, and
 * stopping still returns the operator to themselves.
 */

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** A session row mid-impersonation, as the store holds it. */
const claims = {
  sessionUserId: "operator_1",
  actorUserId: "operator_1",
  subjectUserId: "sam",
  impersonationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

/** What `getServerAuthSession` builds from those claims. */
const sessionFromClaims = () => {
  const principal = resolveSessionPrincipal({ claims });
  return {
    principal,
    user: {
      id: principal.subject.userId,
      name: "Sam Member",
      email: "sam@customer.com",
      impersonator: {
        id: principal.actor.userId,
        name: "Ops Operator",
        email: "operator@langwatch.ai",
      },
    },
  };
};

describe("given an operator impersonating somebody", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("when any page is rendered", () => {
    /** @scenario "The banner and the way out keep working on the new claims" */
    it("shows the banner and names who is being impersonated", () => {
      const session = sessionFromClaims();
      render(<ImpersonationBanner user={session.user} />, { wrapper });

      expect(screen.getByText("Impersonating Sam Member")).toBeInTheDocument();
    });

    /** @scenario "The banner and the way out keep working on the new claims" */
    it("offers the way out, which ends the impersonation and not the session", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      const session = sessionFromClaims();

      render(<ImpersonationBanner user={session.user} />, { wrapper });
      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/admin/impersonate", {
          method: "DELETE",
        });
      });
    });

    /** @scenario "The banner and the way out keep working on the new claims" */
    it("decides the operator's own access by who they really are", () => {
      const session = sessionFromClaims();

      // The pair every authorization decision on this request is recorded
      // against: the operator is the actor whatever account they are looking
      // at, which is what the admin surface's own guard reads.
      const principal = principalOfSession({ session });
      expect(principal.actor.userId).toBe("operator_1");
      expect(principal.subject.userId).toBe("sam");

      const record = permissionDecisionRecord({
        principal,
        permission: "organization:manage",
        scope: { tier: "organization", id: "org_acme" },
        permitted: true,
      });
      expect(record.actorUserId).toBe("operator_1");
      expect(record.subjectUserId).toBe("sam");
    });
  });

  describe("when the impersonation has been stopped", () => {
    /** @scenario "The banner and the way out keep working on the new claims" */
    it("puts the operator back in their own session with no banner", () => {
      const cleared = resolveSessionPrincipal({
        claims: {
          sessionUserId: "operator_1",
          actorUserId: null,
          subjectUserId: null,
          impersonationExpiresAt: null,
        },
      });
      expect(cleared).toEqual({
        actor: { userId: "operator_1" },
        subject: { userId: "operator_1" },
      });

      const { container } = render(
        <ImpersonationBanner
          user={{ name: "Ops Operator", email: "operator@langwatch.ai" }}
        />,
        { wrapper },
      );
      expect(container.innerHTML).toBe("");
    });
  });
});
