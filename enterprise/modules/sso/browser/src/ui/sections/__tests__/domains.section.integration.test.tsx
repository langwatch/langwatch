/**
 * @vitest-environment jsdom
 * The domain ceremony as an administrator drives it: claim, prove, check and
 * remove, the value shown once, lapsed evidence never reading as proved.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { input: { domain: string }; options?: { onSuccess?: (result: unknown) => void } };

/** Every options bag the settling read was mounted with, newest last. */
const { state, polls } = vi.hoisted(() => {
  const operation = () => ({
    calls: [] as Call[],
    answer: void 0 as unknown,
    refusal: null as unknown,
  });

  return {
    polls: [] as { enabled: boolean; refetchInterval: number | false }[],
    state: {
      claimDomain: operation(),
      proveDomain: operation(),
      removeDomain: operation(),
      checkDomainRecord: operation(),
      checkDomainFile: operation(),
    },
  };
});

vi.mock("../../../behavior/sso-api.ts", () => {
  const recorder = (name: keyof typeof state) => ({
    useMutation: () => ({
      isPending: false,
      error: state[name].refusal,
      mutate: (input: Call["input"], options?: Call["options"]) => {
        state[name].calls.push({ input, options });
        options?.onSuccess?.(state[name].answer);
      },
    }),
  });

  return {
    ssoApi: {
      ssoSetup: {
        getSetup: {
          useQuery: (_input: unknown, options: (typeof polls)[number]) => {
            polls.push(options);

            return { data: void 0, isLoading: false, isError: false };
          },
        },
        claimDomain: recorder("claimDomain"),
        proveDomain: recorder("proveDomain"),
        removeDomain: recorder("removeDomain"),
        checkDomainRecord: recorder("checkDomainRecord"),
        checkDomainFile: recorder("checkDomainFile"),
      },
    },
  };
});

import type { DomainClaimView, DomainEvidenceView } from "../../../model/domain-rows.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { DomainsSection } from "../domains.section.tsx";

const TARGET = { organizationId: "org-1", connectionId: "ssoc_1" };

const RECORD = {
  domain: "acme.com",
  label: "_langwatch",
  name: "_langwatch.acme.com",
  type: "TXT",
  file: { path: "/.well-known/langwatch-domain.txt", url: "https://acme.com/.well-known/x.txt" },
  value: "lw-proof-abc123",
  expiresAtMs: Date.UTC(2026, 0, 9),
};

const claimed: DomainClaimView = {
  domain: "acme.com",
  state: "APPROVED",
  waitsForReview: false,
};

type SectionProps = {
  evidence?: DomainEvidenceView[];
  claims?: DomainClaimView[];
  canManage?: boolean;
  provesWithLicense?: boolean;
};

function sectionWith(overrides: SectionProps) {
  return (
    <DomainsSection
      {...TARGET}
      canManage={overrides.canManage ?? true}
      provesWithLicense={overrides.provesWithLicense ?? false}
      evidence={overrides.evidence ?? []}
      claims={overrides.claims ?? [claimed]}
    />
  );
}

function renderSection(overrides: SectionProps = {}) {
  const rendered = renderWithSsoHost(sectionWith(overrides));

  return {
    ...rendered,
    /** The same section, answering a read that has moved on. */
    withRead: (next: SectionProps) => {
      rendered.rerenderWithSsoHost(sectionWith(next));
    },
  };
}

beforeEach(() => {
  for (const operation of Object.values(state)) {
    operation.calls.length = 0;
    operation.answer = void 0;
    operation.refusal = null;
  }
  polls.length = 0;
});

afterEach(cleanup);

describe("given a domain that has been claimed and not proved", () => {
  beforeEach(() => {
    state.proveDomain.answer = { proved: false, record: RECORD };

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Prove this domain" }));
  });

  it("asks the server to prove the domain the row names", () => {
    expect(state.proveDomain.calls[0]?.input).toEqual({ ...TARGET, domain: "acme.com" });
  });

  it("shows the value it was handed, which is answered once and never again", () => {
    expect(screen.getByText("lw-proof-abc123")).toBeTruthy();
    expect(screen.getByText("_langwatch.acme.com")).toBeTruthy();
  });

  it("stops offering to prove it once a value is out, so a second press cannot replace it", () => {
    expect(screen.queryByRole("button", { name: "Prove this domain" })).toBeNull();
  });

  it("asks about the published record for that domain", () => {
    fireEvent.click(screen.getByRole("button", { name: "Check for it now" }));

    expect(state.checkDomainRecord.calls[0]?.input).toEqual({ ...TARGET, domain: "acme.com" });
  });

  it("asks about the file instead, for a reader whose DNS is a ticket away", () => {
    fireEvent.click(screen.getByRole("button", { name: "Check the file instead" }));

    expect(state.checkDomainFile.calls[0]?.input).toEqual({ ...TARGET, domain: "acme.com" });
  });

  it("keeps the value up while the status catches up, because it is issued once", () => {
    fireEvent.click(screen.getByRole("button", { name: "Check for it now" }));

    expect(screen.getByTestId("connection-domain-record")).toBeTruthy();
    expect(screen.getByTestId("connection-domain-pending")).toBeTruthy();
  });
});

const PROVED: DomainEvidenceView = {
  domain: "acme.com",
  proved: true,
  proofState: "VERIFIED",
  graceEndsAtMs: null,
};

describe("given a command the server accepted before the read caught up", () => {
  /** @scenario "A recorded proof refreshes until the setup view shows the proved domain" */
  it("says the proof was accepted, reads again, and stops the moment it is proved", () => {
    state.proveDomain.answer = { proved: false, record: RECORD };
    const { withRead } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Prove this domain" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for it now" }));

    expect(screen.getByTestId("connection-domain-pending")).toHaveTextContent("Proof accepted");
    expect(polls.at(-1)).toEqual({ enabled: true, refetchInterval: 1_000 });

    withRead({ evidence: [PROVED], claims: [] });

    expect(screen.queryByTestId("connection-domain-pending")).toBeNull();
    expect(screen.queryByTestId("connection-domain-record")).toBeNull();
    expect(polls.at(-1)).toEqual({ enabled: false, refetchInterval: false });
    expect(state.checkDomainRecord.calls).toHaveLength(1);
  });

  it("says a removal was accepted until the domain is gone from the rows", () => {
    const { withRead } = renderSection({ evidence: [PROVED], claims: [] });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByTestId("connection-domain-pending")).toHaveTextContent("Removal accepted");

    withRead({ evidence: [], claims: [] });

    expect(screen.queryByTestId("connection-domain-pending")).toBeNull();
    expect(polls.at(-1)).toEqual({ enabled: false, refetchInterval: false });
  });

  it("reads nothing again while nothing is waiting, so a settled page never polls", () => {
    renderSection({ evidence: [PROVED], claims: [] });

    expect(polls.every((options) => !options.enabled)).toBe(true);
  });
});

describe("given a domain this installation proves with its licence", () => {
  it("says there is nothing to publish and offers that press instead", () => {
    renderSection({ provesWithLicense: true });

    expect(screen.getByRole("button", { name: "Prove with our licence" })).toBeTruthy();
    expect(screen.getByText(/enterprise licence is that proof/i)).toBeTruthy();
  });
});

describe("given a proved domain whose record has gone", () => {
  it("never reads as proved, because it is still letting people in", () => {
    renderSection({
      evidence: [{ domain: "acme.com", proved: true, proofState: "LAPSED", graceEndsAtMs: null }],
    });

    expect(screen.getByText("Record missing")).toBeTruthy();
    expect(screen.queryByText("Proved")).toBeNull();
  });
});

describe("given a domain that is proved and still has its evidence", () => {
  it("offers nothing to do about it", () => {
    renderSection({
      evidence: [{ domain: "acme.com", proved: true, proofState: "VERIFIED", graceEndsAtMs: null }],
      claims: [],
    });

    expect(screen.getByText("Proved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prove this domain" })).toBeNull();
  });
});

describe("when an administrator claims a domain", () => {
  it("sends the domain they typed and empties the field", () => {
    renderSection({ claims: [] });

    const field = screen.getByLabelText("Domain");
    fireEvent.change(field, { target: { value: "acme.co.uk" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim domain" }));

    expect(state.claimDomain.calls[0]?.input).toEqual({ ...TARGET, domain: "acme.co.uk" });
    expect(screen.getByLabelText("Domain")).toHaveProperty("value", "");
  });

  it("does not ask the server about an empty box", () => {
    renderSection({ claims: [] });

    expect(screen.getByRole("button", { name: "Claim domain" })).toHaveProperty("disabled", true);
  });
});

describe("when an administrator takes a domain back out", () => {
  it("names the domain it is removing", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(state.removeDomain.calls[0]?.input).toEqual({ ...TARGET, domain: "acme.com" });
  });
});

describe("given a reader who may not manage single sign-on", () => {
  it("shows them where the domain stands and offers them no controls", () => {
    renderSection({ canManage: false });

    expect(screen.getByText("acme.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prove this domain" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByLabelText("Domain")).toBeNull();
  });
});

describe("given a connection with no domains at all", () => {
  it("says so, with an example of what one looks like", () => {
    renderSection({ claims: [] });

    expect(screen.getByText(/no domain has been claimed yet/i)).toBeTruthy();
  });
});

describe("given a step on a domain that was refused", () => {
  it("says which step failed beside the domain, rather than in a toast", () => {
    state.proveDomain.refusal = new Error("refused");
    const { host } = renderSection();

    expect(screen.getAllByTestId("sso-inline-refusal").length).toBeGreaterThan(0);
    expect(screen.getByText("That step on acme.com didn't work")).toBeInTheDocument();
    expect(host.failures).toEqual([]);
  });

  it("names the claim beside the box that was typed into", () => {
    state.claimDomain.refusal = new Error("refused");

    renderSection({ evidence: [], claims: [] });

    expect(screen.getByText("Claiming that domain didn't work")).toBeInTheDocument();
  });
});
