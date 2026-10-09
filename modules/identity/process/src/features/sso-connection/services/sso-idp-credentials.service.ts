import {
  type SsoConnectionState,
  type SsoCredentialKind,
  SsoCredentialsRequiredError,
  type SsoIdentityProviderView,
  type SsoIdpDialing,
  type SsoIdpRegistration,
  type SsoIdpUpdate,
  parseSamlIdpConfig,
} from "@langwatch/identity-contract";

import type { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import type { SsoIdpRegistrationService } from "./sso-idp-registration.service.ts";

interface SsoIdpCredentialsServiceDeps {
  credentials: SsoCredentialRepository;
  registrations: SsoIdpRegistrationService;
}

/** The vault half of the setup journey: what an identity provider registration stores, keeps
 *  and shows. */
export class SsoIdpCredentialsService {
  static create(deps: SsoIdpCredentialsServiceDeps): SsoIdpCredentialsService {
    return new SsoIdpCredentialsService(deps);
  }

  private constructor(private readonly deps: SsoIdpCredentialsServiceDeps) {}

  /**
   * The vault half of a registration. OpenID Connect keeps its two values
   * apart because they are read apart; SAML keeps one document, because half
   * a SAML provider cannot be dialled.
   */
  async storeCredentials({
    organizationId,
    connectionId,
    registration,
  }: {
    organizationId: string;
    connectionId: string;
    registration: SsoIdpRegistration;
  }): Promise<{
    issuer: string | null;
    clientIdRef: string | null;
    secretRef: string | null;
    certRefs: string[];
  }> {
    const vault = (kind: "oidc-client-id" | "oidc-client-secret" | "saml-idp-config") =>
      ({ organizationId, connectionId, kind }) as const;

    if (registration.protocol === "oidc") {
      const { issuer } = await this.deps.registrations.validateOidcRegistration(registration);

      return {
        issuer,
        clientIdRef: await this.deps.credentials.put({
          ...vault("oidc-client-id"),
          value: registration.clientId,
        }),
        secretRef: await this.deps.credentials.put({
          ...vault("oidc-client-secret"),
          value: registration.clientSecret,
        }),
        certRefs: [],
      };
    }

    const config = this.deps.registrations.validateSamlRegistration(registration);
    // The whole dialing document under one reference; `certRefs` is where a
    // connection carries what it was given rather than what it was told.
    const ref = await this.deps.credentials.put({
      ...vault("saml-idp-config"),
      value: JSON.stringify(config),
    });

    return { issuer: config.entityId, clientIdRef: null, secretRef: null, certRefs: [ref] };
  }

  /** What the settings screen shows of a connection's identity provider; never the client
   *  secret. */
  async viewOf(state: SsoConnectionState): Promise<SsoIdentityProviderView> {
    const { organizationId } = state;
    if (state.source !== "self-serve") return { protocol: "grandfathered" };
    const { idpMetadata } = state;
    if (state.type === "oidc") {
      return {
        protocol: "oidc",
        issuer: idpMetadata.issuer,
        clientId: await this.readCredential({ organizationId, ref: idpMetadata.clientIdRef }),
        hasClientSecret: idpMetadata.secretRef !== null,
      };
    }
    const stored = await this.readCredential({
      organizationId,
      ref: idpMetadata.certRefs[0] ?? null,
    });
    const config = stored === null ? null : parseSamlIdpConfig(stored);
    return {
      protocol: "saml",
      entryPoint: config?.entryPoint ?? null,
      entityId: config?.entityId ?? idpMetadata.issuer,
      metadataXml: config?.metadataXml ?? null,
      certificate: config?.certificate ?? null,
    };
  }

  async prepareOidcUpdate({
    state,
    idp,
  }: {
    state: SsoConnectionState;
    idp: Extract<SsoIdpUpdate, { protocol: "oidc" }>;
  }): Promise<SsoIdpDialing> {
    const current = state.idpMetadata;
    const clientSecret =
      idp.clientSecret === null || idp.clientSecret.trim() === "" ? null : idp.clientSecret;
    if (clientSecret === null && current.secretRef === null) {
      throw new SsoCredentialsRequiredError("an openid connect connection needs a client secret");
    }
    const { issuer } = await this.deps.registrations.validateOidcRegistration({
      ...idp,
      // A blank secret keeps the stored one, which satisfies the presence check.
      clientSecret: clientSecret ?? "stored",
    });
    const clientIdRef = await this.keptOrStoredCredential({
      state,
      ref: current.clientIdRef,
      kind: "oidc-client-id",
      value: idp.clientId,
    });
    const secretRef =
      clientSecret === null
        ? current.secretRef
        : await this.keptOrStoredCredential({
            state,
            ref: current.secretRef,
            kind: "oidc-client-secret",
            value: clientSecret,
          });
    return { issuer, clientIdRef, secretRef, certRefs: [] };
  }

  async prepareSamlUpdate({
    state,
    idp,
  }: {
    state: SsoConnectionState;
    idp: Extract<SsoIdpUpdate, { protocol: "saml" }>;
  }): Promise<SsoIdpDialing> {
    const config = this.deps.registrations.validateSamlRegistration(idp);
    const certRef = await this.keptOrStoredCredential({
      state,
      ref: state.idpMetadata.certRefs[0] ?? null,
      kind: "saml-idp-config",
      value: JSON.stringify(config),
    });
    return { issuer: config.entityId, clientIdRef: null, secretRef: null, certRefs: [certRef] };
  }

  /** The stored reference when it already holds this value, otherwise a new
   *  one. A changed value always gets a new reference, so the log records
   *  when a credential changed. */
  private async keptOrStoredCredential({
    state: { organizationId, connectionId },
    ref,
    kind,
    value,
  }: {
    state: SsoConnectionState;
    ref: string | null;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string> {
    if ((await this.readCredential({ organizationId, ref })) === value && ref !== null) return ref;
    return this.deps.credentials.put({ organizationId, connectionId, kind, value });
  }

  private async readCredential({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: string | null;
  }): Promise<string | null> {
    if (ref === null) return null;
    const read = await this.deps.credentials.read({ organizationId, ref });
    return read.found ? read.value : null;
  }
}
