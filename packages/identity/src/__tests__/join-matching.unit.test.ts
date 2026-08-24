import { describe, expect, it } from "vitest";
import {
  coarseColleagueCount,
  isPublicEmailDomain,
  type JoinCandidateOrganization,
  joinDomainOf,
  organizationAdmitsDomainAutomatically,
  PUBLIC_EMAIL_DOMAINS,
  resolveJoinLookup,
} from "../join-matching";

/**
 * The reveal discipline, as a table of refusals.
 *
 * Every test here is really the same assertion from a different angle: an
 * organization a person may not see answers exactly what an organization that
 * does not exist answers. `{ outcome: "none" }` carries no reason field, so
 * the tests cannot check "which nothing" even if somebody wanted to — which
 * is the design, not a limitation of the tests.
 *
 * Spec: specs/identity/join-matching-and-privacy.feature
 */

const acme: JoinCandidateOrganization = {
  organizationId: "org_acme",
  name: "Acme",
  domainJoin: "request",
  connectionAdmitsDomain: false,
  verifiedMembersOnDomain: 3,
  memberCount: 117,
  autoJoinDomains: [],
};

const lookup = (
  organizations: JoinCandidateOrganization[],
  overrides: { email?: string; verified?: boolean; licensed?: boolean } = {},
) =>
  resolveJoinLookup({
    email: overrides.email ?? "sam@acme.com",
    verified: overrides.verified ?? true,
    organizations,
    autoJoinLicensed: overrides.licensed ?? true,
  });

describe("given a verified work address", () => {
  describe("when organizations hold verified addresses on the domain", () => {
    /** @scenario A verified work address finds the organization its colleagues are in */
    it("offers the organization by name and a colleague count, nothing more", () => {
      const decision = lookup([acme]);

      expect(decision).toEqual({
        outcome: "ask",
        organizations: [
          { organizationId: "org_acme", name: "Acme", colleagueCount: 100 },
        ],
      });
      // Nothing about who those colleagues are: the offer's whole shape is
      // three fields, and none of them names a person.
      expect(Object.keys((decision as { organizations: object[] }).organizations[0]!)).toEqual([
        "organizationId",
        "name",
        "colleagueCount",
      ]);
    });

    /** @scenario One verified colleague on the domain is enough to ask */
    it("offers an organization with a single verified colleague", () => {
      const decision = lookup([{ ...acme, verifiedMembersOnDomain: 1 }]);

      expect(decision.outcome).toBe("ask");
    });

    /** @scenario Two organizations on one domain are both offered to ask */
    it("offers both organizations rather than guessing between them", () => {
      const decision = lookup([
        acme,
        { ...acme, organizationId: "org_acme_labs", name: "Acme Labs" },
      ]);

      expect(decision.outcome).toBe("ask");
      expect(
        (decision as { organizations: { organizationId: string }[] }).organizations.map(
          (organization) => organization.organizationId,
        ),
      ).toEqual(["org_acme", "org_acme_labs"]);
    });

    /** @scenario The colleague count is coarse and never a list */
    it("rounds the member count rather than reporting it exactly", () => {
      const decision = lookup([{ ...acme, memberCount: 117 }]);

      const offered = (decision as { organizations: { colleagueCount: number }[] })
        .organizations[0]!;
      expect(offered.colleagueCount).not.toBe(117);
      expect(offered.colleagueCount).toBe(100);
    });
  });

  describe("when only unverified addresses hold the domain", () => {
    /** @scenario Only verified addresses count as evidence */
    it("offers nothing, because an unverified address is not evidence", () => {
      expect(lookup([{ ...acme, verifiedMembersOnDomain: 0 }])).toEqual({
        outcome: "none",
      });
    });
  });

  describe("when the address is written differently from the one on file", () => {
    /** @scenario The address is compared the way it is compared everywhere else */
    it("matches through the attach-time fold and refuses a subdomain", () => {
      // Uppercase, a plus tag and surrounding space all fold to the same
      // domain the identifier was attached with.
      expect(lookup([acme], { email: "  SAM+news@Acme.COM " }).outcome).toBe(
        "ask",
      );

      // A subdomain is a DIFFERENT domain, and that is settled before any
      // organization is consulted: the candidate list is built for whatever
      // this answers, so `mail.acme.com` never reads the `acme.com` list.
      expect(joinDomainOf("  SAM+news@Acme.COM ")).toBe("acme.com");
      expect(joinDomainOf("sam@mail.acme.com")).toBe("mail.acme.com");

      // And with the list the repository would actually return for that
      // domain — nobody holds a verified `mail.acme.com` address — nothing is
      // offered, which is what keeps a lookalike from matching a company.
      expect(
        lookup([{ ...acme, verifiedMembersOnDomain: 0 }], {
          email: "sam@mail.acme.com",
        }),
      ).toEqual({ outcome: "none" });
    });
  });
});

describe("given an address a public email provider issued", () => {
  describe("when organizations hold verified addresses on that domain", () => {
    /** @scenario A public email domain matches nothing, in any mode */
    it("matches nothing whatever the organizations have set", () => {
      const consumer = { ...acme, autoJoinDomains: ["gmail.com"] };

      for (const domainJoin of ["request", "auto"] as const) {
        expect(
          lookup([{ ...consumer, domainJoin }], { email: "sam@gmail.com" }),
        ).toEqual({ outcome: "none" });
      }
    });

    it("treats every listed provider as public and a company subdomain as not", () => {
      for (const domain of PUBLIC_EMAIL_DOMAINS) {
        expect(isPublicEmailDomain(domain)).toBe(true);
      }
      expect(isPublicEmailDomain("acme.com")).toBe(false);
      // `mail.acme.com` is a company subdomain, not consumer mail. Waving one
      // through would be the same mistake as matching one.
      expect(isPublicEmailDomain("mail.gmail.com")).toBe(false);
    });
  });
});

describe("given organizations that are not open to the domain", () => {
  describe("when each is looked up", () => {
    /** @scenario An organization whose identity provider already admits people is not offered */
    it("does not offer an organization whose connection already admits the domain", () => {
      expect(lookup([{ ...acme, connectionAdmitsDomain: true }])).toEqual({
        outcome: "none",
      });
    });

    /** @scenario An organization that turned joining off is invisible, not refused */
    it("answers nothing at all rather than refusing", () => {
      expect(lookup([{ ...acme, domainJoin: "off" }])).toEqual({
        outcome: "none",
      });
    });

    /** @scenario Refusing to offer never says why */
    it("answers every closed door identically", () => {
      const closed = [
        lookup([{ ...acme, domainJoin: "off" }]),
        lookup([{ ...acme, connectionAdmitsDomain: true }]),
        lookup([{ ...acme, verifiedMembersOnDomain: 0 }]),
        lookup([], { email: "sam@gmail.com" }),
        lookup([]),
      ];

      for (const decision of closed) {
        expect(decision).toEqual(closed[0]);
      }
    });
  });
});

describe("given a work organization with a single member", () => {
  describe("when a verified colleague on the same domain looks it up", () => {
    /** @scenario A one-person organization is offered, because a person still decides */
    it("offers it, and an administrator still gates the outcome", () => {
      const solo: JoinCandidateOrganization = {
        ...acme,
        verifiedMembersOnDomain: 1,
        memberCount: 1,
      };

      // Offering this is the orphan-organization fix doing its job. The asker
      // learns only that somebody at a domain they have ALREADY PROVED they
      // hold uses LangWatch, and the one person there decides.
      expect(lookup([solo])).toEqual({
        outcome: "ask",
        organizations: [
          { organizationId: "org_acme", name: "Acme", colleagueCount: 1 },
        ],
      });
    });

    it("never lets a one-person organization admit anybody automatically", () => {
      const solo: JoinCandidateOrganization = {
        ...acme,
        domainJoin: "auto",
        autoJoinDomains: ["acme.com"],
        verifiedMembersOnDomain: 1,
        memberCount: 1,
      };

      // The corroboration threshold is what makes the automatic path safe
      // without a personal-organization predicate: two verified members is
      // something one person cannot be.
      expect(lookup([solo]).outcome).toBe("ask");
      expect(
        organizationAdmitsDomainAutomatically({
          organization: solo,
          domain: "acme.com",
        }),
      ).toBe(false);
    });
  });
});

describe("given an address nobody has verified", () => {
  describe("when the lookup runs", () => {
    /** @scenario Nothing is revealed before the address is verified */
    it("answers nothing without consulting the organizations at all", () => {
      expect(lookup([acme], { verified: false })).toEqual({ outcome: "none" });
    });
  });
});

describe("given an organization that admits its domain automatically", () => {
  describe("when a verified colleague on that domain looks it up", () => {
    it("admits them without an administrator in the loop", () => {
      const decision = lookup([
        {
          ...acme,
          domainJoin: "auto",
          autoJoinDomains: ["acme.com"],
          verifiedMembersOnDomain: 2,
        },
      ]);

      expect(decision).toEqual({
        outcome: "auto",
        organization: {
          organizationId: "org_acme",
          name: "Acme",
          colleagueCount: 100,
        },
      });
    });

    it("falls back to asking when only one member has verified the domain", () => {
      // Nobody gates the automatic path, so one colleague with a
      // company-looking address is not evidence a company owns a domain.
      expect(
        lookup([
          {
            ...acme,
            domainJoin: "auto",
            autoJoinDomains: ["acme.com"],
            verifiedMembersOnDomain: 1,
          },
        ]).outcome,
      ).toBe("ask");
    });

    it("falls back to asking when the administrator never named the domain", () => {
      expect(
        lookup([
          { ...acme, domainJoin: "auto", autoJoinDomains: [], verifiedMembersOnDomain: 4 },
        ]).outcome,
      ).toBe("ask");
    });

    it("falls back to asking when two organizations both claim the domain", () => {
      const automatic = {
        ...acme,
        domainJoin: "auto" as const,
        autoJoinDomains: ["acme.com"],
        verifiedMembersOnDomain: 4,
      };
      const decision = lookup([
        automatic,
        { ...automatic, organizationId: "org_acme_labs", name: "Acme Labs" },
      ]);

      // Guessing which company somebody works for is the one thing this must
      // never do, so neither is admitted and both are offered.
      expect(decision.outcome).toBe("ask");
    });

    /** @scenario Losing the license stops automatic joining without stranding members */
    it("falls back to asking on an unlicensed deployment", () => {
      const decision = lookup(
        [
          {
            ...acme,
            domainJoin: "auto",
            autoJoinDomains: ["acme.com"],
            verifiedMembersOnDomain: 4,
          },
        ],
        { licensed: false },
      );

      // The gate holds `auto` and lets `request` through: nobody already in
      // is stranded, the next colleague simply waits for an approval.
      expect(decision.outcome).toBe("ask");
    });
  });
});

describe("given the pure helpers the rules are built from", () => {
  describe("when a domain is read off an address", () => {
    it("folds the address the way attach does", () => {
      expect(joinDomainOf("  SAM+news@Acme.COM ")).toBe("acme.com");
      expect(joinDomainOf("not-an-address")).toBeNull();
      expect(joinDomainOf("@acme.com")).toBeNull();
    });
  });

  describe("when a member count is coarsened", () => {
    it("stays exact below ten and buckets above it", () => {
      expect(coarseColleagueCount(0)).toBe(0);
      expect(coarseColleagueCount(3)).toBe(3);
      expect(coarseColleagueCount(9)).toBe(9);
      expect(coarseColleagueCount(12)).toBe(10);
      expect(coarseColleagueCount(99)).toBe(90);
      expect(coarseColleagueCount(117)).toBe(100);
      expect(coarseColleagueCount(980)).toBe(950);
      expect(coarseColleagueCount(4321)).toBe(4300);
    });
  });

  describe("when the automatic rule is asked about one organization", () => {
    it("requires the named domain, the corroboration and an open door", () => {
      const automatic: JoinCandidateOrganization = {
        ...acme,
        domainJoin: "auto",
        autoJoinDomains: ["acme.com"],
        verifiedMembersOnDomain: 2,
      };

      expect(
        organizationAdmitsDomainAutomatically({
          organization: automatic,
          domain: "acme.com",
        }),
      ).toBe(true);
      expect(
        organizationAdmitsDomainAutomatically({
          organization: automatic,
          domain: "other.com",
        }),
      ).toBe(false);
      expect(
        organizationAdmitsDomainAutomatically({
          organization: { ...automatic, domainJoin: "request" },
          domain: "acme.com",
        }),
      ).toBe(false);
    });
  });
});
