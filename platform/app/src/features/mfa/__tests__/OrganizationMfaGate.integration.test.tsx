/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The enrollment gate, on the session somebody is already holding.
 *
 * The store below is the whole point of the test rig: it is the SERVER
 * changing its answer for the same session. Nothing in here mints a session,
 * navigates, or signs anybody in — and the assertions say so, because "on the
 * session they already hold" is a promise about what does not happen.
 */
interface Standing {
  organizationId: string;
  organizationName: string;
  required: boolean;
  satisfaction: { satisfied: boolean };
  holdsPasskey: boolean;
}

let standing: Standing | undefined;
const listeners = new Set<() => void>();

function answerWith(next: Standing) {
  standing = next;
  for (const listener of listeners) listener();
}

// Hoisted, because the mock factories below are hoisted above the file's own
// declarations and would otherwise read these before they exist.
const { signIn, navigate } = vi.hoisted(() => ({
  signIn: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { MFA_ENROLLMENT_OPEN: true } }),
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: vi.fn(async () => ({ data: null, error: null })),
      verifyTotp: vi.fn(async () => ({ data: null, error: null })),
    },
  },
  signIn,
  navigate,
}));

vi.mock("~/utils/api", () => ({
  api: {
    // The setup flow behind the gate asks whether this person signs in with a
    // password before it decides to ask for one. Undefined is "not known yet",
    // which the flow reads as holding one — no password field either way, so
    // the gate's own claims are unaffected.
    user: {
      hasPassword: { useQuery: () => ({ data: undefined }) },
    },
    twoStepVerification: {
      standing: {
        useQuery: () => {
          // A live subscription to the mock server's answer, so a refetch
          // re-renders exactly the way a real query does.
          const [, bump] = useState(0);
          useEffect(() => {
            const listener = () => bump((n) => n + 1);
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          }, []);
          return {
            data: standing,
            refetch: async () => {
              // What the server would now say: the setup landed, and the
              // condition is met on the SAME session.
              if (standing) {
                answerWith({ ...standing, satisfaction: { satisfied: true } });
              }
              return { data: standing };
            },
          };
        },
      },
    },
  },
}));

import { OrganizationMfaGate } from "../components/OrganizationMfaGate";
import { useOrganizationMfaGate } from "../hooks/useOrganizationMfaGate";

/** One organization's data, or the gate in front of it. */
function Harness() {
  const gate = useOrganizationMfaGate({ organizationId: "acme" });
  if (!gate.outcome.held) {
    return <div data-testid="acme-data">Acme data</div>;
  }
  return (
    <OrganizationMfaGate
      organizationName={gate.outcome.organizationName}
      offerPasskey={gate.outcome.offerPasskey}
      onEnrolled={gate.refresh}
    />
  );
}

function renderHarness() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Harness />
    </ChakraProvider>,
  );
}

describe("the enrollment gate", () => {
  beforeEach(() => {
    signIn.mockClear();
    navigate.mockClear();
  });

  afterEach(() => {
    cleanup();
    standing = undefined;
  });

  describe("given sam is held at the enrollment gate for acme", () => {
    beforeEach(() => {
      standing = {
        organizationId: "acme",
        organizationName: "Acme",
        required: true,
        satisfaction: { satisfied: false },
        holdsPasskey: false,
      };
    });

    describe("when sam finishes setting two-step verification up", () => {
      /** @scenario Setting it up opens the gate on the session they already hold */
      it("makes acme's data reachable on the same session, without signing in again", async () => {
        renderHarness();
        expect(screen.getByTestId("organization-mfa-gate")).toBeInTheDocument();
        expect(screen.queryByTestId("acme-data")).toBeNull();

        // The setup finishing is exactly one thing from the gate's side: ask
        // the same question again, on the same session.
        answerWith({
          organizationId: "acme",
          organizationName: "Acme",
          required: true,
          satisfaction: { satisfied: true },
          holdsPasskey: false,
        });

        expect(await screen.findByTestId("acme-data")).toBeInTheDocument();
        expect(screen.queryByTestId("organization-mfa-gate")).toBeNull();
        // Nothing signed anybody in, and nothing navigated anywhere.
        expect(signIn).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given acme requires two-step verification", () => {
    describe("when an invited person with no enrollment has just become a member", () => {
      /** @scenario Someone joining an organization that requires it meets the gate on the way in */
      it("meets the gate on the way in, named for the organization asking", () => {
        // They ARE a member — the standing is answered for acme at all, which
        // is what a non-member never gets past — and the very first thing
        // they reach is the gate rather than acme's data.
        standing = {
          organizationId: "acme",
          organizationName: "Acme",
          required: true,
          satisfaction: { satisfied: false },
          holdsPasskey: false,
        };

        renderHarness();

        const gate = screen.getByTestId("organization-mfa-gate");
        expect(gate.textContent).toContain("Acme");
        expect(gate.textContent).toMatch(/two-step verification/i);
        // The way through is named as setting one up, and never as signing in
        // again: nothing about their session is wrong.
        expect(screen.getByTestId("two-factor-password")).toBeInTheDocument();
        expect(gate.textContent).not.toMatch(/sign in again/i);
        expect(screen.queryByTestId("acme-data")).toBeNull();
      });
    });
  });

  describe("given acme asks for nothing", () => {
    /** @scenario Setting it up opens the gate on the session they already hold */
    it("never holds anybody", () => {
      standing = {
        organizationId: "acme",
        organizationName: "Acme",
        required: false,
        satisfaction: { satisfied: true },
        holdsPasskey: false,
      };

      renderHarness();

      expect(screen.getByTestId("acme-data")).toBeInTheDocument();
    });
  });
});
