import { HandledError } from "@langwatch/handled-error";
import {
  CHECKUP_DOCS,
  type CheckId,
  type CheckVerdict,
  type ExplicitCheckInput,
} from "@langwatch/ops-contract";

import type {
  CanaryName,
  CheckupFacts,
  ProviderTestOutcome,
} from "../../../rules/checkup-facts.rules.ts";
import {
  NOT_ASKED_FOR,
  bodyText,
  firstLine,
  hostOf,
  normalizeUrl,
  portOf,
  reasonOf,
} from "../../../rules/checkup-text.rules.ts";

const UNTESTED_REASONS: Record<string, string> = {
  no_credential: "no key stored",
  credential_masked: "no key stored",
  no_endpoint: "no endpoint to ask",
  provider_not_probeable: "its sign-in cannot be tested from here",
  unknown_provider: "not a known provider",
};

function untestedList(results: { provider: string; result: ProviderTestOutcome }[]): string {
  return results.map((entry) => `${entry.provider} (${untestedReason(entry.result)})`).join(", ");
}

function untestedReason(result: ProviderTestOutcome): string {
  if (result.outcome !== "unchecked") return result.outcome;
  return UNTESTED_REASONS[result.reason] ?? result.reason.replaceAll("_", " ");
}

/** The checks that cost egress or money, run only because someone asked. */
export class CheckupPaidService {
  private constructor(private readonly facts: CheckupFacts) {}

  static create(facts: CheckupFacts): CheckupPaidService {
    return new CheckupPaidService(facts);
  }

  async run(id: CheckId, input: ExplicitCheckInput): Promise<CheckVerdict> {
    switch (id) {
      case "reach_connect_host":
        return this.reachLangWatch("licenseHost");
      case "reach_gateway_host":
        return this.reachLangWatch("gatewayHost");
      case "gateway_control_plane":
        return this.gatewayControlPlane();
      case "storage_probe":
        return this.storageProbe();
      case "smtp_verify":
        return this.smtpVerify();
      case "model_provider_test":
        return this.modelProviderTest();
      case "canary_collector":
        return this.canary("collector", {});
      case "canary_processor":
        return this.canary("processor", {});
      case "canary_evaluations":
        return this.canary("evaluations", {});
      case "canary_scenarios":
        return input.scenarioRunPlanId
          ? this.canary("scenarios", { runPlanId: input.scenarioRunPlanId })
          : {
              outcome: "unchecked",
              detail: "The scenario canary launches a real run and needs a run plan to launch.",
              fix: "Name a run plan id or slug and run this check again.",
            };
      case "canary_langy":
        return this.canary("langy", {});
      default:
        return NOT_ASKED_FOR;
    }
  }

  /** A LangWatch host is probed only while Connect is allowed; a probe is a connection too. */
  private async reachLangWatch(which: "licenseHost" | "gatewayHost"): Promise<CheckVerdict> {
    const connect = await this.facts.connect();
    if (connect.deployment === "off") {
      return {
        outcome: "unchecked",
        detail:
          "Not run. LANGWATCH_CONNECT_DISABLED is set, so this install opens no connection to LangWatch.",
      };
    }
    return this.reach(connect[which]);
  }

  private async reach(host: string): Promise<CheckVerdict> {
    const url = host.includes("://") ? host : `https://${host}`;
    try {
      await this.facts.reach(url);
      return { outcome: "verified", detail: `${hostOf(url)} answers on port ${portOf(url)}.` };
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      return {
        outcome: "refused",
        code: error.code,
        detail: `${hostOf(url)} could not be reached on port ${portOf(url)}.`,
        fix: error.message,
        docsPath: CHECKUP_DOCS.connect,
        meta: { ...error.meta, host: hostOf(url), port: portOf(url) },
      };
    }
  }

  private async gatewayControlPlane(): Promise<CheckVerdict> {
    const gateway = await this.facts.gateway();
    const known = gateway.controlPlaneUrls;
    const expected = known[0];
    if (!gateway.baseUrl || !expected) {
      return {
        outcome: "unchecked",
        detail: "No AI Gateway is configured, so there is no control plane to compare.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    const probe = await gateway.probeControlPlane();
    if (probe.kind === "unreachable") {
      return {
        outcome: "unchecked",
        detail: `The gateway did not answer GET /debug/control-plane: ${probe.reason}. An older gateway build has no such route.`,
        fix: "Upgrade the gateway to the release that ships with this app, then run this check again.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    const reported = normalizeUrl(probe.controlPlaneBaseUrl);
    if (!known.some((url) => normalizeUrl(url) === reported)) {
      return {
        outcome: "refused",
        code: "checkup_gateway_control_plane_mismatch",
        detail:
          `The gateway reports its control plane as ${probe.controlPlaneBaseUrl}; this app is at ${expected}. ` +
          "Requests return 200 while budgets, spend and auth apply to another install.",
        fix: "Point the gateway's control plane at this app (GATEWAY_CONTROL_PLANE_URL on the gateway) and restart it.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    return {
      outcome: "verified",
      detail: `The gateway reports ${probe.controlPlaneBaseUrl} as its control plane, which is this app.`,
    };
  }

  private async storageProbe(): Promise<CheckVerdict> {
    const [destination] = await this.facts.storage.findDestination();
    if (!destination) {
      return {
        outcome: "unchecked",
        detail: "No project exists yet, so there is no storage destination to write to.",
      };
    }
    try {
      await this.facts.storage.probe();
      return {
        outcome: "verified",
        detail: `One object was written to ${destination} and deleted.`,
      };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_storage_write_failed",
        detail: `Writing to ${destination} failed: ${reasonOf(error)}`,
        fix: "Check the bucket or path exists and that the app's credentials allow put and delete on it.",
        docsPath: CHECKUP_DOCS.environment,
      };
    }
  }

  private async smtpVerify(): Promise<CheckVerdict> {
    const email = await this.facts.email();
    if (!email.smtpConfigured) {
      return {
        outcome: "unchecked",
        detail: email.provider
          ? `Email goes through ${email.provider}, which has no connection to verify. Send a test invitation to check it.`
          : "SMTP is not configured.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
    try {
      await email.verifySmtp();
      return {
        outcome: "verified",
        detail: email.smtpSendsCredentials
          ? "The SMTP server accepted a connection and the credentials."
          : "The SMTP server accepted a connection.",
      };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_smtp_refused",
        detail: `The SMTP server refused: ${reasonOf(error)}`,
        fix: "Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
  }

  private async modelProviderTest(): Promise<CheckVerdict> {
    const providers = await this.facts.modelProviders();
    if (providers.length === 0) {
      return {
        outcome: "unchecked",
        detail: "No model provider is configured, so there is nothing to test.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    try {
      await this.facts.modelProviderBudget();
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      const retry = Number(error.meta?.retryAfterSeconds ?? 60);
      return {
        outcome: "unchecked",
        detail: `This organization used its connection test budget for the minute. Try again in ${retry} seconds.`,
      };
    }
    const results = await Promise.all(
      providers.slice(0, 5).map(async (row) => ({
        provider: row.provider,
        result: await this.facts.testModelProvider(row),
      })),
    );
    const refused = results.flatMap((entry) =>
      entry.result.outcome === "refused" ? [{ provider: entry.provider, ...entry.result }] : [],
    );
    const [firstRefusal] = refused;
    if (firstRefusal) {
      return {
        outcome: "refused",
        code: "checkup_model_provider_refused",
        detail:
          `${refused.map((entry) => entry.provider).join(", ")} refused the connection test. ${firstRefusal.message}`.trim(),
        fix: "Open Settings, Model providers, and test the provider there to see the refusal in full.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    const verified = results.filter((entry) => entry.result.outcome === "verified");
    if (verified.length === 0) {
      return {
        outcome: "unchecked",
        detail: `None of the configured providers could be tested: ${untestedList(results)}.`,
      };
    }
    return {
      outcome: "verified",
      detail: `Connected: ${verified.map((entry) => entry.provider).join(", ")}.`,
    };
  }

  private async canary(name: CanaryName, params: Record<string, string>): Promise<CheckVerdict> {
    const answer = await this.facts.canary(name, params);
    if (answer.status === 404 && name === "langy") {
      return {
        outcome: "unchecked",
        detail: "Langy is not enabled for this project, so there is no turn to send.",
      };
    }
    if (answer.status >= 200 && answer.status < 300) {
      return { outcome: "verified", detail: `The ${name} canary came back healthy.` };
    }
    return {
      outcome: "refused",
      code: `checkup_canary_${name}_failed`,
      detail: `The ${name} canary answered ${answer.status}: ${firstLine(bodyText(answer.body))}`,
      fix: `Read the ${name} logs for the canary's trace, then see the troubleshooting page.`,
      docsPath: CHECKUP_DOCS.troubleshooting,
    };
  }
}
