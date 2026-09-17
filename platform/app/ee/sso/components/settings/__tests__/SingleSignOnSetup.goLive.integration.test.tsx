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
import type {
  SsoArrivalPolicy,
  SsoConnectionLifecycleState,
} from "@langwatch/identity";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  setupRef,
  bindingsRef,
  candidatesRef,
  hasPermissionMock,
  ssoSignInMock,
  activateMock,
  invalidateSetupMock,
  invalidateScimMock,
  grantMock,
  renewMock,
  setArrivalsMock,
  arrivalsSave,
} = vi.hoisted(() => ({
  setupRef: { current: undefined as unknown, error: null as unknown },
  bindingsRef: { current: [] as unknown[], error: null as unknown },
  candidatesRef: { current: [] as unknown[] },
  hasPermissionMock: vi.fn(),
  ssoSignInMock: vi.fn(),
  activateMock: vi.fn(),
  invalidateSetupMock: vi.fn(),
  invalidateScimMock: vi.fn(),
  grantMock: vi.fn(),
  renewMock: vi.fn(),
  setArrivalsMock: vi.fn(),
  arrivalsSave: {
    onSuccess: null as (() => Promise<void>) | null,
    pending: false,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: ssoSignInMock } },
  // The test sign-in names the reader's own address in the copy for one of
  // our own refusals, so the hook reads the session.
  useSession: () => ({ data: { user: { email: "admin@acme.test" } } }),
}));

vi.mock("~/utils/api", () => {
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
        startLegacyMigration: idle(),
        selectMigrationRoute: idle(),
        finalizeLegacyMigration: idle(),
        proveDomain: idle(),
        checkDomainRecord: idle(),
        checkDomainFile: idle(),
        setArrivals: {
          useMutation: ({ onSuccess }: { onSuccess: () => Promise<void> }) => {
            arrivalsSave.onSuccess = onSuccess;
            return {
              mutate: setArrivalsMock,
              isPending: arrivalsSave.pending,
            };
          },
        },
        claimDomain: idle(),
        removeDomain: idle(),
        activate: mutation(activateMock),
        // The name on the summary card is editable in place now.
        rename: mutation(vi.fn()),
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
        getHistory: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        onHistoryActivity: { useSubscription: () => undefined },
      },
      ssoConnections: {
        startLegacyMigration: idle(),
      },
      useUtils: () => ({
        ssoSetup: {
          getSetup: { invalidate: invalidateSetupMock },
          getHistory: { invalidate: vi.fn() },
          breakGlassBindings: { invalidate: vi.fn() },
        },
        // What going live has to refresh besides its own screen: the token
        // dialog on the next page decides what to offer from this read.
        scimReconciliation: { invalidate: invalidateScimMock },
        ssoConnections: { invalidate: vi.fn() },
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
  arrivalPolicy = "admit",
}: {
  goLive: {
    domainProved: boolean;
    testSignIn: { done: boolean; atMs: number | null };
    breakGlass: { inPlace: boolean; liveCount: number };
    arrivalsDecided: boolean;
    ready: boolean;
    activated: boolean;
  };
  state?: SsoConnectionLifecycleState;
  verifiedDomains?: string[];
  arrivalPolicy?: SsoArrivalPolicy;
}) {
  return {
    availability: { available: true, proof: "dns-record" },
    serviceProvider: SERVICE_PROVIDER,
    serviceProviderBeforeRegistration: SERVICE_PROVIDER,
    connection: {
      connectionId: CONNECTION_ID,
      state,
      type: "oidc",
      providerId: "Okta",
      issuer: "https://login.acme.okta.com",
      arrivalPolicy,
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
  arrivalsDecided: false,
  ready: false,
  activated: false,
};

const EVERYTHING_DONE = {
  domainProved: true,
  testSignIn: { done: true, atMs: 1_756_000_000_000 },
  breakGlass: { inPlace: true, liveCount: 1 },
  arrivalsDecided: true,
  ready: true,
  activated: false,
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
  arrivalsSave.onSuccess = null;
  arrivalsSave.pending = false;
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

  /** @scenario "The journey asks who the connection lets in" */
  it("offers the three answers at the step after the way back in", () => {
    setupRef.current = setupWith({
      goLive: { ...NOTHING_DONE, domainProved: true },
    });

    draw();

    // The step exists as its own question rather than as a default nobody
    // was asked: turning a connection on without saying what it does with
    // somebody it has never seen is choosing by not choosing.
    expect(screen.getByText("Say who it lets in")).toBeInTheDocument();
    expect(screen.getByText("Only people already here")).toBeInTheDocument();
    expect(screen.getByText("They ask, you approve")).toBeInTheDocument();
    expect(
      screen.getByText("They join, on a domain you verified"),
    ).toBeInTheDocument();
  });

  /** @scenario "The journey asks who the connection lets in" */
  it("says the widest answer rests on the domain proof rather than on a count of who receives mail", () => {
    setupRef.current = setupWith({
      goLive: { ...NOTHING_DONE, domainProved: true },
    });

    draw();

    expect(
      screen.getByText(/Only addresses on a domain you verified ever reach it/),
    ).toBeInTheDocument();
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

  /** @scenario "The initial arrival choice can be confirmed without changing the default" */
  it("records the displayed default and waits for the saved decision", async () => {
    setupRef.current = setupWith({
      arrivalPolicy: "refuse",
      goLive: { ...EVERYTHING_DONE, arrivalsDecided: false, ready: false },
    });
    const { rerender } = draw();

    expect(screen.getByTestId("arrivals-refuse")).toBeChecked();
    expect(setArrivalsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^go live$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm choice" }));

    expect(setArrivalsMock).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org_acme",
      connectionId: CONNECTION_ID,
      policy: "refuse",
    });
    if (!arrivalsSave.onSuccess) throw new Error("Missing save callback");
    await arrivalsSave.onSuccess();
    expect(invalidateSetupMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /^go live$/i })).toBeNull();
    expect(activateMock).not.toHaveBeenCalled();

    setupRef.current = setupWith({
      arrivalPolicy: "refuse",
      goLive: EVERYTHING_DONE,
    });
    rerender(
      <ChakraProvider value={defaultSystem}>
        <SingleSignOnSetup organizationId="org_acme" />
      </ChakraProvider>,
    );

    expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
    expect(screen.getByRole("button", { name: /^go live$/i })).toBeEnabled();
    expect(activateMock).not.toHaveBeenCalled();
  });

  /** @scenario "A claimed connection cannot confirm arrivals before its domain is verified" */
  it("keeps arrival policy unavailable until the connection proves a domain", () => {
    setupRef.current = setupWith({
      state: "CLAIMED",
      goLive: NOTHING_DONE,
      verifiedDomains: [],
    });

    draw();

    expect(
      screen.getByText("Verify a domain to configure who can join."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("arrivals-refuse")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
    expect(setArrivalsMock).not.toHaveBeenCalled();
  });

  it("offers arrival policy confirmation after the connection is verified", () => {
    setupRef.current = setupWith({
      state: "VERIFIED",
      goLive: { ...EVERYTHING_DONE, arrivalsDecided: false, ready: false },
    });

    draw();

    expect(
      screen.getByRole("button", { name: "Confirm choice" }),
    ).toBeEnabled();
    expect(screen.getByTestId("arrivals-refuse")).toBeEnabled();
  });

  it("keeps Save and Cancel for edits to an already decided policy", async () => {
    const user = userEvent.setup();
    setupRef.current = setupWith({
      arrivalPolicy: "refuse",
      goLive: EVERYTHING_DONE,
    });
    draw();
    await user.click(screen.getByText("Say who it lets in"));

    expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(screen.getByText("They ask, you approve"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("arrivals-refuse")).toBeChecked();
    expect(setArrivalsMock).not.toHaveBeenCalled();

    await user.click(screen.getByText("They join, on a domain you verified"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setArrivalsMock).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org_acme",
      connectionId: CONNECTION_ID,
      policy: "admit",
    });
  });

  /** @scenario "Only administrators can confirm the initial arrival choice" */
  it("shows the undecided policy without offering a read-only viewer confirmation", () => {
    hasPermissionMock.mockReturnValue(false);
    setupRef.current = setupWith({
      arrivalPolicy: "refuse",
      goLive: { ...EVERYTHING_DONE, arrivalsDecided: false, ready: false },
    });
    draw();

    expect(screen.getByTestId("arrivals-refuse")).toBeChecked();
    expect(screen.getByTestId("arrivals-refuse")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
    expect(setArrivalsMock).not.toHaveBeenCalled();
  });

  it("disables the initial confirmation while its save is pending", () => {
    setupRef.current = setupWith({
      arrivalPolicy: "refuse",
      goLive: { ...EVERYTHING_DONE, arrivalsDecided: false, ready: false },
    });
    arrivalsSave.pending = true;
    draw();

    expect(
      screen.getByRole("button", { name: "Saving choice" }),
    ).toBeDisabled();
    expect(screen.getByTestId("arrivals-refuse")).toBeDisabled();
    expect(setArrivalsMock).not.toHaveBeenCalled();
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

  /** @scenario "A connection just turned on can carry a provisioning token without a reload" */
  it("refreshes what the provisioning step reads, not only its own screen", async () => {
    setupRef.current = setupWith({ goLive: EVERYTHING_DONE });

    draw();
    fireEvent.click(screen.getByRole("button", { name: /^go live$/i }));

    // The success path is the thing under test: the dialog that issues a
    // token lives on another page and decides what to offer from the
    // reconciliation read, which sits behind a stale window. Without this it
    // said no connection was live yet, about the one just turned on.
    const onSuccess = activateMock.mock.calls.at(-1)?.[1]?.onSuccess;
    expect(onSuccess).toBeTypeOf("function");
    await onSuccess();

    expect(invalidateSetupMock).toHaveBeenCalled();
    expect(invalidateScimMock).toHaveBeenCalled();
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
        // The END of the day they picked, IN THE READER'S OWN TIMEZONE. A
        // grant that stopped working just after midnight would end a day
        // before the date it says; one built through UTC lands on the wrong
        // day entirely for anybody east of it, which is what this used to
        // assert. Constructed rather than written as a literal, because a
        // literal `…T23:59:59.999Z` IS the bug.
        expiresAtMs: new Date(2026, 11, 31, 23, 59, 59, 999).getTime(),
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
        expiresAtMs: new Date(2026, 11, 31, 23, 59, 59, 999).getTime(),
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
  /** @scenario "A connection that is live says sign-in is decided by it" */
  it("says the connection is on and that sign-in is decided by it", () => {
    setupRef.current = setupWith({
      state: "ACTIVE",
      goLive: { ...EVERYTHING_DONE, activated: true },
    });

    const { container } = draw();

    // The status chip carries the state; the line under it carries the one
    // thing the chip cannot fit — that this is the moment sign-in moved, and
    // that the administrator can move it back themselves.
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain(
      "People at your verified domains sign in through your identity provider",
    );
    // The state that only existed because a second switch did.
    expect(container.textContent).not.toContain("not routing yet");
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
