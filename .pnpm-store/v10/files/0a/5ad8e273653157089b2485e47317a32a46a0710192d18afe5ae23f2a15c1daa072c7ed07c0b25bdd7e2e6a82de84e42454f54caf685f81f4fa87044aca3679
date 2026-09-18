# Security Policy

This document describes the management of vulnerabilities for `fast-uri`, an
official Fastify project package. It supplements the Fastify project's
[organization-wide security policy](https://github.com/fastify/.github/blob/main/SECURITY.md).

## Standards and scope

`fast-uri` implements URI parsing and normalization according to
[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986). It does not implement the
[WHATWG URL Standard](https://url.spec.whatwg.org/).

Differences between `fast-uri` and WHATWG URL implementations are expected.
Reports based on comparing or mixing parsers that follow these different
standards are out of scope. Applications must use the same parsing and
normalization rules for both security decisions and subsequent URI use.

## Threat model

`fast-uri`'s threat model extends the
[Node.js threat model](https://github.com/nodejs/node/blob/main/SECURITY.md#the-nodejs-threat-model).

**Trusted:** Application code, parser options, configuration, and the runtime
environment.

**Untrusted:** URI and IRI strings passed to the package's public APIs.

### Examples of vulnerabilities

- RFC 3986 parsing or normalization flaws that bypass security controls
- Denial of service through malformed input
- Inconsistent parsing or normalization between `fast-uri` APIs

### Examples of non-vulnerabilities

The following are **not** considered vulnerabilities in `fast-uri`:

- **Different URL standards:** Differences between RFC 3986 behavior and
  WHATWG URL behavior, including differences exposed by mixing parsers that
  implement those standards
- **Unsupported scheme semantics:** Scheme-specific behavior for schemes that
  `fast-uri` does not document as supported
- **Application code vulnerabilities:** Security flaws in code that consumes
  `fast-uri` output
- **Configuration mistakes:** Security issues caused by incorrect parser
  options or application configuration
- **Missing security features:** Application-level protections that are not
  part of URI parsing or normalization
- **Third-party dependencies:** Vulnerabilities in packages used by an
  application alongside `fast-uri`

## Reporting vulnerabilities

Individuals who find potential vulnerabilities in `fast-uri` are invited to
complete a vulnerability report via the
[GitHub Security page][advisory].

Do not assign or request a CVE directly.
CVE assignment is handled by the Fastify Security Team.
Fastify falls under the [OpenJS CNA](https://cna.openjsf.org/).
A CVE will be assigned as part of our responsible disclosure process.

> [!NOTE]
> Fastify's [HackerOne](https://hackerone.com/fastify) program is now closed.

[advisory]: ../../security/advisories/new

### Strict measures when reporting vulnerabilities

It is of the utmost importance that you read carefully and follow these
guidelines to ensure the ecosystem as a whole is not disrupted due to
improperly reported vulnerabilities:

- Avoid creating new "informative" reports. Only create a new report if you are
  confident the issue is an actual vulnerability. Third-party vendors and
  individuals track new GitHub security reports and may flag them for their
  customers.
- Security reports should never be created and triaged by the same person. A
  second Security Team member must triage a report submitted by a team member
  or on their behalf. If in doubt, invite more Fastify collaborators to help
  review the report.
- **Do not** attempt to demonstrate CI/CD vulnerabilities by creating pull
  requests in Fastify organization repositories. Doing so will result in a
  [content report][content-report] to GitHub as an unsolicited exploit. Create
  a separate repository configured like the affected repository and provide
  the proof of concept there instead.

[content-report]: https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam#reporting-an-issue-or-pull-request

### Vulnerabilities found outside this process

The Fastify project does not support vulnerability reporting outside the
process described in this document.

## Handling vulnerability reports

When a potential vulnerability is reported, the following actions are taken.

### Triage

**Delay:** 4 business days

Within 4 business days, a member of the Security Team provides a first response
to the reporter. The possible responses are:

- **Acceptance:** The report is considered a new vulnerability.
- **Rejection:** The report is not considered a new vulnerability.
- **Need more information:** The Security Team needs more information to
  evaluate the report.

Triaging should include updating these issue fields:

- Asset: set or create the module affected by the report
- Severity: TBD, initially left empty

### Correction follow-up

**Delay:** 90 days

When a vulnerability is confirmed, a member of the Security Team volunteers to
follow up on the report.

With the reporter's help, they contact the maintainers of the vulnerable
package and may invite them as participants in the report. Together, they
define a publication date. Ideally, publication should not happen before the
package has been patched.

The report's vulnerable-version upper limit should be set to:

- `*` if no fixed version is available when the report is published
- the last vulnerable version, such as `<=1.2.3`, if the fix is released in
  `1.2.4`

### Publication

**Delay:** 90 days

Within 90 days after triage, the vulnerability must be made public.

Vulnerability severity is assessed using
[CVSS v3](https://www.first.org/cvss/user-guide).

If package maintainers are actively developing a patch, the Security Team and
the reporter may approve an additional delay.

### Secondary contact

If you do not receive an acknowledgment within 6 business days, or cannot find
a private security contact, contact the OpenJS Foundation CNA at
<https://cna.openjsf.org/> or `security@lists.openjsf.org` for assistance.

The CNA can help ensure that reports are acknowledged, coordinate disclosure
timelines, and assign CVEs when necessary.

## The Fastify Security Team

The core team manages the security program, policy, and process.

Team members must keep all privileged information private. This includes the
existence of undisclosed issues, expected release dates, and upcoming patches.

### Members

- [Matteo Collina](https://github.com/mcollina)
- [Tomas Della Vedova](https://github.com/delvedor)
- [Vincent Le Goff](https://github.com/zekth)
- [KaKa Ng](https://github.com/climba03003)
- [James Sumners](https://github.com/jsumners)
