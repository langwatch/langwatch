# Security Policy

## Reporting a vulnerability

Email **security@langwatch.ai**.

Please do not open a public GitHub issue, pull request, or Discord message for a
security problem. A public report puts every LangWatch user at risk during the
window before a fix ships.

A useful report includes:

- the affected component and version, or the commit you tested against
- what an attacker can do, and what access they need to start
- steps to reproduce, ideally with the exact requests or a short script
- anything you already know about impact or blast radius

You do not need a finished exploit. A clear description of the weakness is
enough to open a case.

If you have a PGP key preference or need an encrypted channel, say so in your
first email and we will arrange one.

## What we commit to

| Stage | Target |
|-------|--------|
| Acknowledgement that a human has the report | 2 business days |
| Initial assessment, including whether we reproduced it | 5 business days |
| Fix or documented mitigation for critical and high severity | 30 days |
| Fix or documented mitigation for medium and low severity | 90 days |

We will keep you updated as the work progresses rather than going quiet, and we
will tell you if a date is going to slip.

When a fix ships we publish a GitHub Security Advisory for the affected package
or component, request a CVE where one is warranted, and mark affected released
versions so that dependency scanners pick the fix up.

## Coordinated disclosure

We ask for 90 days from your report before public disclosure, or until a fix is
released, whichever comes first. If a fix is going to take longer than that we
will come back to you and explain why rather than expect silence by default.

We are glad to credit you in the advisory and the release notes. Tell us how you
would like to be named and whether to include an affiliation. If you would
rather stay anonymous, that is fine too.

## Scope

In scope:

- this repository, including the LangWatch platform, SDKs, CLI, AI gateway, and
  the `@langwatch/mcp-server` package
- `app.langwatch.ai` and `api.langwatch.ai`
- LangWatch container images and Helm charts published from this repository
- LangWatch packages published to npm and PyPI

Out of scope:

- findings that only affect a self-hosted deployment the reporter has
  deliberately misconfigured, unless the insecure setting is our default or our
  documented recommendation
- reports produced only by an automated scanner, with no demonstrated impact
- missing hardening headers, cookie flags, or TLS configuration with no
  attack path attached
- rate limiting on unauthenticated endpoints with no security consequence
- social engineering of LangWatch staff or users, and physical attacks
- vulnerabilities in third-party services we consume, which should go to that
  vendor
- outdated dependencies with no exploitable path in LangWatch. If you can show
  the path, that is in scope and we want it

## Safe harbour

If you make a good-faith effort to follow this policy, we will treat your
research as authorized. We will not pursue or support legal action against you,
and if a third party brings action over research that followed this policy, we
will make it known that you were authorized.

Good faith means:

- you only access data belonging to accounts you own or have permission to test
- you stop as soon as you have confirmed a vulnerability, rather than pivoting
  deeper into the system
- you do not degrade service for other users, exfiltrate data, or destroy or
  modify data that is not yours
- if you encounter personal data, you stop, do not save it, and tell us
- you give us a reasonable window to fix the issue before going public

If you are unsure whether something is in scope or whether a test crosses a
line, email us first and ask. We would rather answer a question than have you
guess.

## Reporting a security problem in someone else's LangWatch deployment

If you find an exposed self-hosted LangWatch instance that is not yours, please
tell us at security@langwatch.ai and we will try to reach the operator. Do not
test against it.
