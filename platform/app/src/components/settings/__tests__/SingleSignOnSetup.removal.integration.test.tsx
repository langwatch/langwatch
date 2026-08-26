/**
 * @vitest-environment jsdom
 *
 * The way back out of a connection, and which of the two removals a press
 * actually is (wave 3 — see specs/identity/sso-connection-lifecycle.feature).
 *
 * The aggregate has two removal verbs and refuses each from the other's
 * states: a discard is pre-live only, a teardown is for a connection that
 * reached live. So the screen picking the wrong one is not a cosmetic slip —
 * it is a danger-zone button whose only possible outcome is a refusal.
 *
 * The screen used to pick by asking whether the connection was activated,
 * which is `state === "ACTIVE"` and nothing else. A SUSPENDED connection and
 * one already scheduled for removal both answered no, both sent a discard,
 * and both were refused. These scenarios press the button in each state and
 * assert which mutation ran, because asserting on the rendered copy alone
 * would have passed against exactly that bug.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setupRef, hasPermissionMock, discardMock, removeMock } = vi.hoisted(
  () => ({
    setupRef: { current: undefined as unknown, error: null as unknown },
    hasPermissionMock: vi.fn(),
    discardMock: vi.fn(),
    removeMock: vi.fn(),
  }),
);

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock("../../../utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
}));

vi.mock("../../../utils/api", () => {
  const mutation = (mutate: ReturnType<typeof vi.fn>) => ({
    useMutation: () => ({ mutate, isPending: false }),
  });
  const idle = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  const empty = () => ({
    useQuery: () => ({ data: [], isLoading: false, error: null }),
  });
  return {
    api: {
      ssoSetup: {
        getSetup: {
          useQuery: () => ({
            isLoading: false,
            data: setupRef.current,
            error: setupRef.error,
          }),
        },
        register: idle(),
        proveDomain: idle(),
        checkDomainRecord: idle(),
        checkDomainFile: idle(),
        setArrivals: idle(),
        claimDomain: idle(),
        removeDomain: idle(),
        activate: idle(),
        grantBreakGlass: idle(),
        renewBreakGlass: idle(),
        revokeBreakGlass: idle(),
        discardConnection: mutation(discardMock),
        removeConnection: mutation(removeMock),
        breakGlassBindings: empty(),
        breakGlassCandidates: empty(),
      },
      useUtils: () => ({
        ssoSetup: {
          getSetup: { invalidate: vi.fn() },
          breakGlassBindings: { invalidate: vi.fn() },
        },
      }),
    },
  };
});

import { SingleSignOnSetup } from "../SingleSignOnSetup";

const CONNECTION_ID = "ssoc_acme";
const SCHEDULED_AT = Date.UTC(2026, 8, 2, 4, 31, 36);

const SERVICE_PROVIDER = {
  redirectUrl: `https://app.test/api/auth/sso/callback/${CONNECTION_ID}`,
  assertionConsumerServiceUrl: `https://app.test/api/auth/sso/saml2/sp/acs/${CONNECTION_ID}`,
  singleLogoutUrl: `https://app.test/api/auth/sso/saml2/sp/slo/${CONNECTION_ID}`,
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl: `https://app.test/api/auth/sso/saml2/sp/metadata?providerId=${CONNECTION_ID}`,
};

function setupIn({
  state,
  tearDownAfterMs = null,
}: {
  state: string;
  tearDownAfterMs?: number | null;
}) {
  return {
    availability: { available: true, proof: "dns-record" },
    serviceProvider: SERVICE_PROVIDER,
    connection: {
      connectionId: CONNECTION_ID,
      state,
      type: "oidc",
      providerId: "Okta",
      issuer: "https://login.acme.okta.com",
      arrivalPolicy: "admit" as const,
      tearDownAfterMs,
      verifiedDomains: ["acme.com"],
      domainProofs: [
        { domain: "acme.com", proofState: "VERIFIED", graceEndsAtMs: null },
      ],
    },
    claims: [],
    record: null,
    goLive: {
      domainProved: true,
      testSignIn: { done: true, atMs: 1_756_000_000_000 },
      breakGlass: { inPlace: true, liveCount: 1 },
      arrivalsDecided: true,
      ready: true,
      // The fact the screen used to decide on. Left false in every scenario
      // below on purpose: it is false for SUSPENDED and TEARDOWN_PENDING in
      // production too, and that is precisely what broke.
      activated: state === "ACTIVE",
      routingSwitchedOn: true,
    },
    attestationOffered: false,
  };
}

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SingleSignOnSetup organizationId="org_acme" />
    </ChakraProvider>,
  );

/** Open the danger zone's confirmation and press the destructive button. */
function pressRemove() {
  fireEvent.click(screen.getByTestId("sso-remove-open"));
  fireEvent.click(screen.getByTestId("sso-remove-confirm"));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  setupRef.error = null;
});

afterEach(cleanup);

describe("given a connection that never went live", () => {
  describe("when the administrator removes it", () => {
    it("discards it", () => {
      setupRef.current = setupIn({ state: "VERIFIED" });
      draw();

      pressRemove();

      expect(discardMock).toHaveBeenCalledWith(
        { organizationId: "org_acme", connectionId: CONNECTION_ID },
        expect.anything(),
      );
      expect(removeMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a live connection", () => {
  describe("when the administrator removes it", () => {
    it("schedules the removal on teardown's terms", () => {
      setupRef.current = setupIn({ state: "ACTIVE" });
      draw();

      pressRemove();

      expect(removeMock).toHaveBeenCalledWith(
        {
          organizationId: "org_acme",
          connectionId: CONNECTION_ID,
          reason: null,
        },
        expect.anything(),
      );
      expect(discardMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a paused connection", () => {
  describe("when the administrator removes it", () => {
    // SUSPENDED is not activated and has very much gone live. The aggregate
    // refuses a discard from it, so a discard here is a guaranteed refusal.
    /** @scenario "Which removal a press sends is read from where the connection stands" */
    it("schedules the removal rather than discarding it", () => {
      setupRef.current = setupIn({ state: "SUSPENDED" });
      draw();

      pressRemove();

      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(discardMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection whose removal is already scheduled", () => {
  beforeEach(() => {
    setupRef.current = setupIn({
      state: "TEARDOWN_PENDING",
      tearDownAfterMs: SCHEDULED_AT,
    });
  });

  describe("when the administrator removes it again", () => {
    /** @scenario "Which removal a press sends is read from where the connection stands" */
    it("asks again for the teardown instead of sending a refused discard", () => {
      draw();

      pressRemove();

      expect(removeMock).toHaveBeenCalledWith(
        {
          organizationId: "org_acme",
          connectionId: CONNECTION_ID,
          reason: null,
        },
        expect.anything(),
      );
      expect(discardMock).not.toHaveBeenCalled();
    });
  });

  describe("when the administrator reads the danger zone", () => {
    /** @scenario "Which removal a press sends is read from where the connection stands" */
    it("says the removal is already scheduled, and when", () => {
      draw();

      const zone = screen.getByTestId("sso-remove-open").closest("div");
      expect(zone?.textContent ?? "").toContain("already being removed");
      expect(screen.getByText(/already being removed/).textContent).toContain(
        new Date(SCHEDULED_AT).toLocaleDateString(),
      );
    });
  });
});
