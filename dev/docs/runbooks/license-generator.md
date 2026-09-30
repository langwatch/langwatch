# Licences for dev stacks, QA and seeding

Self-hosted LangWatch gates the Enterprise surface (audit log, ingestion
sources, anomaly rules, multi-user surfaces, the governance dashboard) on a
signed licence. There is **no env-var bypass** and **no committed licence**: a
dev stack gets a real licence, signed from a dev key pair you hold in your
root `.env`.

## How a dev stack gets its licence

1. **The stack trusts your dev public key.** `LANGWATCH_LICENSE_PUBLIC_KEY` in
   the root `.env` is the verifier's existing override
   (`licensingConfig`, `enterprise/modules/licensing/contract/src/licensing.config.ts`).
   Without it a stack verifies against the production key only
   (`DEFAULT_LICENSE_PUBLIC_KEY`).
2. **The private key lives only in secrets.** `LANGWATCH_LICENSE_PRIVATE_KEY`
   (`licensingSecrets.licensePrivateKey`) resolves through the ADR-132 chain:
   the environment, the root `.env`, then 1Password when
   `LANGWATCH_OP_ACCOUNT` names an account
   (`op://Private/LangWatch/LANGWATCH_LICENSE_PRIVATE_KEY`).
3. **The storage seed signs a fresh licence**
   (`apps/tasks/src/storage-seed/seed-license.ts`, `chooseSeedLicense`), in
   this order:
   - a stored licence that is valid (signature and expiry) under the boot
     public key is kept, so a re-seed never clobbers one someone activated;
   - otherwise, with the private key set, it signs an Enterprise licence bound
     to `local-dev-organization`. A private key that does not pair with the
     boot public key stores no licence and logs one line saying so;
   - otherwise the licensing test suite's fixture, when it is valid (CI boots
     with the test public key, see `.github/workflows/e2e-ci.yml`);
   - otherwise no licence, and one log line naming
     `LANGWATCH_LICENSE_PRIVATE_KEY`.

Signing and verification live in `@langwatch/enterprise-license-signing`
(`enterprise/packages/license-signing`), which the licensing module and the
seed both import, so the seed signs exactly what the verifier checks.

## Setting it up

1. Generate a dev key pair (never the production signing key):

   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out dev-license.pem
   openssl pkey -in dev-license.pem -pubout -out dev-license.pub.pem
   ```

2. Put both halves in the root `.env`, each on one line with `\n` escapes, in
   double quotes (the `.env` reader is line-based; the verifier expands `\n`):

   ```bash
   printf 'LANGWATCH_LICENSE_PUBLIC_KEY="%s"\n' "$(awk '{printf "%s\\n", $0}' dev-license.pub.pem)" >> .env
   printf 'LANGWATCH_LICENSE_PRIVATE_KEY="%s"\n' "$(awk '{printf "%s\\n", $0}' dev-license.pem)" >> .env
   rm dev-license.pem dev-license.pub.pem
   ```

   The private key may live in 1Password instead: the `LangWatch` item of your
   `Private` vault, field `LANGWATCH_LICENSE_PRIVATE_KEY`, with
   `LANGWATCH_OP_ACCOUNT` set.
3. `haven down` and `haven up` (a restart does not reload the environment),
   or `haven db seed` on a running stack. The seed logs which licence it
   stored.

## Revoked licences

`REVOKED_LICENSE_IDS` in `enterprise/packages/license-signing/src/node-license-cryptography.ts`
lists licences that never verify, whatever signed them. It holds
`lic-d6f0f20c-f1f9-4489-bc0a-77b156986b0c`, the production-signed local-dev
licence that was committed to this public repository.

## Why no env-var bypass, and no committed licence

A bypass or a committed licence bakes the way around licensing into a public
repository: a licence signed by the production key works on any self-hosted
install it is pasted into. It also hides plan-resolution bugs, because QA
stops exercising the path customers take. `LANGWATCH_DEV_FORCE_ENTERPRISE` was
removed for that reason, and `LOCAL_DEV_ENTERPRISE_LICENSE_KEY` with it.

## Security notes

- `LANGWATCH_LICENSE_PRIVATE_KEY` is the trust root for every stack that
  trusts the matching public key. Never commit it, log it or screenshot it.
- The production signing key never belongs on a dev machine.
- A seeded licence is bound to `local-dev-organization`; it activates on no
  other organization.
- `LANGWATCH_LICENSE_PUBLIC_KEY` is itself an override: whoever sets it on a
  deployment decides which licences that deployment accepts.
