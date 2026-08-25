/**
 * @vitest-environment jsdom
 *
 * Getting from a registered identity provider to a live one, without an
 * operator (wave 3 — see specs/identity/sso-activation.feature).
 *
 * What is under test here is the JOURNEY as a customer meets it: the step
 * that proves the connection carries a person, the step that names somebody
 * who can still get in without it, and the step that turns it on with all
 * three preconditions shown rather than only the first missing one. The
 * refusals themselves belong to the service's suite; what this file asserts
 * is that the screen offers the right act, in the customer's words, to the
 * right reader.
 *
 * The error presentation registry is deliberately NOT mocked: a scenario
 * about a failed read saying something a customer can act on is worth
 * nothing against a stub that returns the word "t".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  setupRef,
  bindingsRef,
  candidatesRef,
  hasPermissionMock,
  ssoSignInMock,
  activateMock,
  grantMock,
  renewMock,
} = vi.hoisted(() => ({
  setupRef: { current: undefined as unknown, error: null as unknown },
  bindingsRef: { current: [] as unknown[], error: null as unknown },
  candidatesRef: { current: [] as unknown[] },
  hasPermissionMock: vi.fn(),
  ssoSignInMock: vi.fn(),
  activateMock: vi.fn(),
  grantMock: vi.fn(),
  renewMock: vi.fn(),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock("../../../utils/auth-client", () => ({
  authClient: { signIn: { sso: ssoSignInMock } },
}));

vi.mock("../../../utils/api", () => {
  const mutation = (mutate: ReturnType<typeof vi.fn>) => ({
    useMutation: () => ({ mutate, isPending: false }),
  });
  const idle = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
        claimDomain: idle(),
        removeDomain: idle(),
        activate: mutation(activateMock),
        grantBreakGlass: mutation(grantMock),
        renewBreakGlass: mutation(renewMock),
        revokeBreakGlass: idle(),
        discardConnection: idle(),
        removeConnection: idle(),
        breakGlassBindings: {
          useQuery: () => ({
            data: bindingsRef.current,
            isLoading: false,
            error: bindingsRef.error,
          }),
        },
        breakGlassCandidates: {
          useQuery: () => ({
            data: candidatesRef.current,
            isLoading: false,
            error: null,
          }),
        },
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
const DAY = 24 * 60 * 60 * 1000;

const SERVICE_PROVIDER = {
  redirectUrl: `https://app.test/api/auth/sso/callback/${CONNECTION_ID}`,
  assertionConsumerServiceUrl: `https://app.test/api/auth/sso/saml2/sp/acs/${CONNECTION_ID}`,
  singleLogoutUrl: `https://app.test/api/auth/sso/saml2/sp/slo/${CONNECTION_ID}`,
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl: `https://app.test/api/auth/sso/saml2/sp/metadata?providerId=${CONNECTION_ID}`,
};

/** The setup payload, with the go-live checklist a scenario cares about. */
function setupWith({
  goLive,
  state = "VERIFIED",
  verifiedDomains = ["acme.com"],
}: {
  goLive: {
    domainProved: boolean;
    testSignIn: { done: boolean; atMs: number | null };
    breakGlass: { inPlace: boolean; liveCount: number };
    ready: boolean;
    activated: boolean;
    routingSwitchedOn: boolean;
  };
  state?: string;
  verifiedDomains?: string[];
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
      verifiedDomains,
      domainProofs: verifiedDomains.map((domain) => ({
        domain,
        proofState: "VERIFIED",
        graceEndsAtMs: null,
      })),
    },
    claims: [],
    record: null,
    goLive,
    attestationOffered: false,
  };
}

const NOTHING_DONE = {
  domainProved: false,
  testSignIn: { done: false, atMs: null },
  breakGlass: { inPlace: false, liveCount: 0 },
  ready: false,
  activated: false,
  routingSwitchedOn: false,
};

const EVERYTHING_DONE = {
  domainProved: true,
  testSignIn: { done: true, atMs: 1_756_000_000_000 },
  breakGlass: { inPlace: true, liveCount: 1 },
  ready: true,
  activated: false,
  routingSwitchedOn: false,
};

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SingleSignOnSetup organizationId="org_acme" />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  setupRef.current = setupWith({ goLive: NOTHING_DONE });
  setupRef.error = null;
  bindingsRef.current = [];
  bindingsRef.error = null;
  candidatesRef.current = [
    { userId: "user_ben", name: "Ben", email: "ben@acme.com" },
  ];
  ssoSignInMock.mockResolvedValue({
    data: { url: "https://idp" },
    error: null,
  });
});

afterEach(cleanup);

describe("given an administrator whose identity provider is registered", () => {
  /** @scenario "The test sign-in is offered on the setup screen once a provider is registered" */
  it("offers a test sign-in and says where it will send them", () => {
    const { container } = draw();

    expect(screen.getByRole("button", { name: /test sign-in/i })).toBeTruthy();
    // Named in what it does, not in what it is: the reader is told they will
    // go to their own identity provider and come back.
    expect(container.textContent).toContain(
      "This sends you to Okta to sign in, then brings you back here.",
    );
  });

  /** @scenario "The test sign-in names the connection rather than waiting for routing" */
  it("sends the test at this organization's own connection, not through the auth screens", () => {
    draw();

    fireEvent.click(screen.getByRole("button", { name: /test sign-in/i }));

    // The connection id, which is what the engine keys a provider by. Naming
    // it outright is what makes the test possible while the organization's
    // sign-in has not been switched over.
    expect(ssoSignInMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: CONNECTION_ID }),
    );
  });

  /** @scenario "The go-live step shows all three preconditions rather than the first missing one" */
  it("shows all three preconditions outstanding, each with the step that meets it", () => {
    const { container } = draw();

    expect(container.textContent).toContain("No domain of yours is proved yet");
    expect(container.textContent).toContain(
      "Nobody has signed in through the connection yet",
    );
    expect(container.textContent).toContain(
      "Nobody can get in without the identity provider",
    );
    expect(container.textContent).toContain("Use the test sign-in in step 3.");
    expect(container.textContent).toContain("Grant a way back in in step 4.");
    expect(screen.queryByRole("button", { name: /^go live$/i })).toBeNull();
  });

  /** @scenario "The go-live button is offered only once every precondition is met" */
  it("offers the go-live control once every precondition is met", () => {
    setupRef.current = setupWith({ goLive: EVERYTHING_DONE });

    draw();

    fireEvent.click(screen.getByRole("button", { name: /^go live$/i }));

    expect(activateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_acme",
        connectionId: CONNECTION_ID,
      }),
      expect.anything(),
    );
  });
});

describe("given the ways back in an organization holds", () => {
  /** @scenario "The ways back in are listed with who holds them and until when" */
  it("names who holds one and the date it ends", () => {
    // Nobody in the grant picker, so the name found below can only have come
    // from the list of who actually holds a way in.
    candidatesRef.current = [];
    bindingsRef.current = [
      {
        bindingId: "bgb_1",
        userId: "user_ben",
        name: "Ben",
        email: "ben@acme.com",
        grantedByUserId: "user_ana",
        grantedByName: "Ana",
        grantedAtMs: 1_756_000_000_000 - DAY,
        expiresAtMs: 1_756_000_000_000 + 10 * DAY,
        supersededAtMs: null,
        live: true,
        daysRemaining: 10,
      },
    ];

    const { container } = draw();

    expect(screen.getByText("Ben")).toBeTruthy();
    expect(container.textContent).toContain("Granted by Ana");
    expect(container.textContent).toContain("10 days left");
  });

  /** @scenario "A way back in is not offered in our words" */
  it("describes it as somebody who can still sign in with a password", () => {
    const { container } = draw();

    expect(container.textContent).toContain(
      "Name one person who can still sign in with a password if it ever stops working",
    );
    // None of OUR vocabulary. The protocol's own name is not in this list:
    // the summary card names the connection by its protocol, exactly as the
    // overview does, because "OpenID Connect" is the word on the
    // administrator's own console — the ban is on terms of ours a customer
    // would have to look up.
    for (const jargon of ["break glass", "break-glass", "binding"]) {
      expect(container.textContent?.toLowerCase()).not.toContain(
        jargon.toLowerCase(),
      );
    }
  });

  /** @scenario "Granting a way back in names a person and a date" */
  it("grants one to the person and the date the administrator chose", () => {
    draw();

    fireEvent.change(screen.getByLabelText("Who can still get in"), {
      target: { value: "user_ben" },
    });
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /grant a way back in/i }),
    );

    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_acme",
        userId: "user_ben",
        // The END of the day they picked: a grant that stopped working just
        // after midnight would end a day before the date it says.
        expiresAtMs: new Date("2026-12-31T23:59:59.999Z").getTime(),
      }),
      expect.anything(),
    );
  });

  /** @scenario "A way back in can be extended before it ends" */
  it("extends one that already exists rather than replacing the person", () => {
    bindingsRef.current = [
      {
        bindingId: "bgb_1",
        userId: "user_ben",
        name: "Ben",
        email: "ben@acme.com",
        grantedByUserId: "user_ana",
        grantedByName: "Ana",
        grantedAtMs: 1_756_000_000_000 - DAY,
        expiresAtMs: 1_756_000_000_000 + DAY,
        supersededAtMs: null,
        live: true,
        daysRemaining: 1,
      },
    ];

    draw();

    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /extend to the date/i }),
    );

    expect(renewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_acme",
        bindingId: "bgb_1",
        expiresAtMs: new Date("2026-12-31T23:59:59.999Z").getTime(),
      }),
      expect.anything(),
    );
  });

  /** @scenario "A reader who may not manage single sign-on is offered no grant" */
  it("lists them for a reader who may only look, and offers no way to grant one", () => {
    hasPermissionMock.mockReturnValue(false);
    bindingsRef.current = [
      {
        bindingId: "bgb_1",
        userId: "user_ben",
        name: "Ben",
        email: "ben@acme.com",
        grantedByUserId: "user_ana",
        grantedByName: "Ana",
        grantedAtMs: 1_756_000_000_000 - DAY,
        expiresAtMs: 1_756_000_000_000 + 10 * DAY,
        supersededAtMs: null,
        live: true,
        daysRemaining: 10,
      },
    ];

    draw();

    expect(screen.getByText("Ben")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /grant a way back in/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /extend to the date/i }),
    ).toBeNull();
  });
});

describe("given a connection that is already on", () => {
  /** @scenario "A connection that is live but not routing says so plainly" */
  it("says the connection is on and that sign-in has not moved to it", () => {
    setupRef.current = setupWith({
      state: "ACTIVE",
      goLive: { ...EVERYTHING_DONE, activated: true, routingSwitchedOn: false },
    });

    const { container } = draw();

    expect(container.textContent).toContain(
      "The connection is on, and sign-in has not moved to it yet",
    );
    expect(container.textContent).toContain(
      "Everyone still signs in the way they do today.",
    );
  });

  /** @scenario "A connection that is live and routing says that instead" */
  it("says people in the proved domains sign in through the identity provider", () => {
    setupRef.current = setupWith({
      state: "ACTIVE",
      goLive: { ...EVERYTHING_DONE, activated: true, routingSwitchedOn: true },
    });

    const { container } = draw();

    expect(container.textContent).toContain("Single sign-on is on");
    expect(container.textContent).toContain(
      "now sign in through your identity provider",
    );
  });
});

describe("given a read that could not be answered", () => {
  /** @scenario "A step that cannot be read says so rather than looking finished" */
  it("says what went wrong in the words registered for the code, and ticks nothing", () => {
    setupRef.current = undefined;
    setupRef.error = {
      data: {
        error: {
          code: "sso_self_serve_unavailable",
          httpStatus: 403,
          fault: "customer",
        },
      },
    };

    const { container } = draw();

    // The registry's words for that code, not the wire message — which since
    // #5984 is the code itself.
    expect(container.textContent).toContain(
      "Setting single sign-on up yourself",
    );
    expect(container.textContent).not.toContain("sso_self_serve_unavailable");
    // And nothing that would read as a finished step.
    expect(screen.queryAllByTestId("step-done")).toEqual([]);
  });

  it("says the ways back in could not be read rather than showing none", () => {
    bindingsRef.current = [];
    bindingsRef.error = {
      data: {
        error: {
          code: "sso_self_serve_unavailable",
          httpStatus: 403,
          fault: "customer",
        },
      },
    };

    const { container } = draw();

    expect(container.textContent).toContain(
      "We could not load the ways back in",
    );
    expect(container.textContent).not.toContain(
      "Nobody can get in without your identity provider yet",
    );
  });
});
