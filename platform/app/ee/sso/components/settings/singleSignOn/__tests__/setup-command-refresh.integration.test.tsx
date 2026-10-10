/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainsSection } from "../DomainsSection";
import { GoLiveSection } from "../GoLiveSection";

type DomainProps = ComponentProps<typeof DomainsSection>;
type RefreshSetup = {
  connection: DomainProps["connection"];
  goLive: NonNullable<ComponentProps<typeof GoLiveSection>["goLive"]>;
};
const { readSetup, checkRecord, checkFile, activate, invalidateProvisioning } =
  vi.hoisted(() => ({
    readSetup: vi.fn<() => Promise<RefreshSetup>>(),
    activate: vi.fn<() => Promise<void>>(),
    invalidateProvisioning: vi.fn<() => Promise<void>>(),
    checkRecord: vi.fn<() => Promise<{ proved: true }>>(),
    checkFile: vi.fn<() => Promise<{ proved: true }>>(),
  }));

vi.mock("~/utils/api", async () => {
  const query = await import("@tanstack/react-query");
  const { useMutation, useQuery, useQueryClient } = query;
  const idle = {
    useMutation: () => useMutation({ mutationFn: async () => null }),
  };
  return {
    api: {
      ssoSetup: {
        getSetup: {
          useQuery: (
            input: { organizationId: string },
            options: { refetchInterval: number },
          ) =>
            useQuery({
              queryKey: ["setup", input.organizationId],
              queryFn: readSetup,
              ...options,
            }),
        },
        checkDomainRecord: {
          useMutation: () => useMutation({ mutationFn: checkRecord }),
        },
        checkDomainFile: {
          useMutation: () => useMutation({ mutationFn: checkFile }),
        },
        activate: {
          useMutation: () => useMutation({ mutationFn: activate }),
        },
        claimDomain: idle,
        proveDomain: idle,
        removeDomain: idle,
      },
      useUtils: () => {
        const client = useQueryClient();
        return {
          scimReconciliation: { invalidate: invalidateProvisioning },
          ssoSetup: {
            getSetup: {
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["setup", "org_acme"] }),
            },
          },
        };
      },
    },
  };
});

const unproved: DomainProps["connection"] = {
  connectionId: "conn_acme",
  state: "APPROVED",
  type: "saml",
  providerId: "Acme SAML",
  issuer: "https://idp.acme.test",
  source: "self-serve",
  replacesConnectionId: null,
  migrationPhase: null,
  arrivalPolicy: "refuse",
  tearDownAfterMs: null,
  verifiedDomains: [],
  domainProofs: [],
};
const proved: DomainProps["connection"] = {
  ...unproved,
  state: "VERIFIED",
  verifiedDomains: ["acme.test"],
};

const readyGoLive: RefreshSetup["goLive"] = {
  domainProved: true,
  testSignIn: { done: true, atMs: 1 },
  breakGlass: { inPlace: true, liveCount: 1 },
  arrivalsDecided: true,
  ready: true,
  activated: false,
};
const unsettled: RefreshSetup = { connection: unproved, goLive: readyGoLive };

function SetupRead({
  domain = "acme.test",
  surface = "domain",
}: {
  domain?: string;
  surface?: "domain" | "activation";
}) {
  const setup = useQuery({
    queryKey: ["setup", "org_acme"],
    queryFn: readSetup,
  });
  if (!setup.data) return null;
  if (surface === "activation") {
    return (
      <GoLiveSection
        organizationId="org_acme"
        connectionId="conn_acme"
        canManage
        goLive={setup.data.goLive}
      />
    );
  }
  return (
    <DomainsSection
      organizationId="org_acme"
      connectionId="conn_acme"
      canManage
      provesWithLicense={false}
      connection={setup.data.connection}
      claims={[
        {
          domain,
          state: "APPROVED",
          claimedAtMs: 1,
          decidedAtMs: 2,
          waitedMs: null,
          note: null,
          waitsForReview: false,
        },
      ]}
      record={{
        domain,
        type: "TXT",
        label: "_langwatch-verification",
        name: `_langwatch-verification.${domain}`,
        value: "synthetic-proof",
        file: {
          path: "/.well-known/langwatch-verification",
          url: `https://${domain}/.well-known/langwatch-verification`,
        },
        expiresAtMs: null,
        expired: false,
      }}
    />
  );
}

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  readSetup.mockResolvedValue(unsettled);
  activate.mockResolvedValue();
  invalidateProvisioning.mockResolvedValue();
  checkRecord.mockResolvedValue({ proved: true });
  checkFile.mockResolvedValue({ proved: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function draw(surface: "domain" | "activation" = "domain") {
  return render(<SetupRead surface={surface} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
      </QueryClientProvider>
    ),
  });
}

describe("a successful domain proof awaiting its setup projection", () => {
  const channels = ["record", "file"];
  /** @scenario "A recorded proof refreshes until the setup view shows the proved domain" */
  it.each(channels)("observes the delayed %s proof", async (channel) => {
    draw();
    fireEvent.click(
      await screen.findByRole("button", { name: `Check for the ${channel}` }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Proof accepted",
    );
    expect(screen.getByText("Not proved yet")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Replace the secret value" }),
    ).toBeDisabled();

    // The immediate invalidation still read the old projection. Only polling
    // can observe the later database commit; no reload or extra click follows.
    readSetup.mockResolvedValue({ ...unsettled, connection: proved });
    await waitFor(() => expect(screen.getByText("Proved")).toBeVisible(), {
      timeout: 3_000,
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(checkRecord).toHaveBeenCalledTimes(channel === "record" ? 1 : 0);
    expect(checkFile).toHaveBeenCalledTimes(channel === "file" ? 1 : 0);

    readSetup.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(readSetup).not.toHaveBeenCalled();
  });

  /** @scenario "Proving one domain leaves another domain available for verification" */
  it("requires a separate proof for the next domain", async () => {
    const view = draw();
    fireEvent.click(
      await screen.findByRole("button", { name: "Check for the record" }),
    );
    await screen.findByRole("status");
    readSetup.mockResolvedValue({ ...unsettled, connection: proved });
    await waitFor(() => expect(screen.getByText("Proved")).toBeVisible(), {
      timeout: 3_000,
    });

    view.rerender(<SetupRead domain="checks.acme.test" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Not proved yet")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check for the record" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Replace the secret value" }),
    ).toBeEnabled();
    readSetup.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(readSetup).not.toHaveBeenCalled();
    expect(checkRecord).toHaveBeenCalledTimes(1);
  });

  it("does not start watching a proof that the server refused", async () => {
    checkRecord.mockRejectedValue(new Error("Proof was not found"));
    draw();
    fireEvent.click(
      await screen.findByRole("button", { name: "Check for the record" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Not proved yet")).toBeVisible();
    readSetup.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(readSetup).not.toHaveBeenCalled();
  });
});

describe("an accepted activation awaiting its setup projection", () => {
  /** @scenario "An accepted activation refreshes until the connection is shown as active" */
  it("shows the live connection without another activation or reload", async () => {
    draw("activation");
    fireEvent.click(await screen.findByRole("button", { name: "Go live" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Activation accepted",
    );
    expect(screen.getByRole("button", { name: "Turning on" })).toBeDisabled();
    await waitFor(() => expect(invalidateProvisioning).toHaveBeenCalledOnce());

    readSetup.mockResolvedValue({
      ...unsettled,
      goLive: { ...readyGoLive, activated: true },
    });
    expect(
      await screen.findByRole(
        "link",
        { name: "Set up provisioning" },
        {
          timeout: 3_000,
        },
      ),
    ).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
    expect(activate).toHaveBeenCalledOnce();
    readSetup.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(readSetup).not.toHaveBeenCalled();
  });
});
