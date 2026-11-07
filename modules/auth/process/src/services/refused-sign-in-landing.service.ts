import type { UnfinishedSignIn } from "@langwatch/auth-contract";
import type {
  RefusedSignInClassification,
  RefusedSignInInput,
  SignInIdpKind,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { getActiveTraceId } from "@langwatch/observability/tracing";
import type { Instant } from "@langwatch/time";

import { refusedSignInLocationOf } from "../rules/sign-in-callback-failure.rules.ts";
import {
  buildClearedSignInHintCookie,
  extractCallbackSource,
  extractHintedAddress,
  extractSignInHintCookie,
  type SignInHintSealer,
  UNFINISHED_SIGN_IN_TTL_MS,
} from "../rules/sign-in-hint.rules.ts";

const logger = createLogger("langwatch:auth");

type RefusedSignInLandingDeps = Readonly<{
  baseUrl(): string;
  now(): Instant;
  signInHints(): SignInHintSealer;
  refusedSignIns: Readonly<{
    classifyRefusedSignIn(input: RefusedSignInInput): Promise<RefusedSignInClassification>;
  }>;
  newReferenceId(): string;
}>;

/** Where a refused or unfinished sign-in lands, classified by identity within a bounded wait. */
export class RefusedSignInLandingService {
  static create(deps: RefusedSignInLandingDeps): RefusedSignInLandingService {
    return new RefusedSignInLandingService(deps);
  }

  private constructor(private readonly deps: RefusedSignInLandingDeps) {}

  /**
   * A sign-in this browser started whose provider never answered back, read from the unspent hint:
   * the provider kind and the id to dial again, never the address. Nobody is told, nothing mailed.
   */
  async readUnfinishedSignIn({ request }: { request: Request }): Promise<Response> {
    const sealed = extractSignInHintCookie(request.headers.get("cookie"));
    const hint = sealed
      ? this.deps.signInHints().decode({
          value: sealed,
          nowMs: this.deps.now().epochMilliseconds,
          maxAgeMs: UNFINISHED_SIGN_IN_TTL_MS,
        })
      : undefined;
    const headers = { "cache-control": "no-store" };
    // Only a company connection can refuse for want of an app assignment; social starts never do.
    if (!hint || hint.source === "provider") {
      return Response.json({ unfinished: null } satisfies UnfinishedSignIn, { headers });
    }
    let idp: SignInIdpKind | null = null;
    try {
      const answer = await withinClassificationTime({
        pending: this.deps.refusedSignIns.classifyRefusedSignIn({
          refusedBy: { kind: "connection", connectionId: hint.providerId },
          email: null,
        }),
        reference: getActiveTraceId() ?? null,
      });
      if (answer !== "timed_out") idp = answer.idp;
    } catch (error) {
      logger.warn({ error }, "an unfinished sign-in's provider kind could not be read");
    }
    return Response.json(
      { unfinished: { providerId: hint.providerId, idp } } satisfies UnfinishedSignIn,
      { headers },
    );
  }

  /**
   * The refusal page an admin set on their identity provider: the same card as a refused
   * callback, naming the provider kind only. No mail, since no round trip names the person.
   */
  async landOnRefusalCard({
    request,
    connectionId,
  }: {
    request: Request;
    connectionId: string;
  }): Promise<Response> {
    const reference = getActiveTraceId() ?? this.deps.newReferenceId();
    let verdict: RefusedSignInClassification | undefined;
    try {
      const answer = await withinClassificationTime({
        pending: this.deps.refusedSignIns.classifyRefusedSignIn({
          refusedBy: { kind: "connection", connectionId },
          email: null,
        }),
        reference,
      });
      if (answer !== "timed_out") verdict = answer;
    } catch (error) {
      logger.error(
        { error, reference, connectionId },
        "a refusal page visit could not be classified; the person was sent the plain refusal",
      );
    }
    logger.warn(
      {
        reference,
        connectionId,
        organizationId: verdict?.organizationId ?? null,
        idp: verdict?.idp ?? null,
      },
      "an identity provider sent a refused person to its refusal page; the person was told why",
    );
    const location = refusedSignInLocationOf({
      location: `${this.deps.baseUrl()}/auth/error`,
      verdict: verdict && { idp: verdict.idp, outcome: "refused" },
      reference,
    });
    const headers = new Headers({ location, "cache-control": "no-store" });
    // The sign-in ended here, so the next visit does not call it unfinished.
    if (extractSignInHintCookie(request.headers.get("cookie")) !== undefined) {
      headers.append(
        "set-cookie",
        buildClearedSignInHintCookie({ secure: this.deps.baseUrl().startsWith("https:") }),
      );
    }
    return new Response(null, { status: 302, headers });
  }

  /**
   * An identity provider's refusal: told apart as a seat limit or a refusal naming the provider
   * kind, from the callback path and the signed hint only. Any failure here keeps the plain
   * refusal: classifying it never blocks the redirect (specs/identity/idp-refused-sign-in.feature).
   */
  async classifyRefusal({
    request,
    location,
    traceId,
    echoedRoundTrip,
    answeredCode,
  }: {
    request: Request;
    location: string;
    traceId: string | undefined;
    echoedRoundTrip: string | undefined;
    /** What Better Auth answered, e.g. `saml_no_assertion` for a posted SAML refusal. */
    answeredCode: string;
  }): Promise<string> {
    const reference = traceId ?? this.deps.newReferenceId();
    const source = extractCallbackSource({ pathname: new URL(request.url).pathname });
    let verdict: RefusedSignInClassification | undefined;
    if (source) {
      const { hintProviderId, ...refusedBy } = source;
      const sealed = extractSignInHintCookie(request.headers.get("cookie"));
      const hint = sealed
        ? this.deps
            .signInHints()
            .decode({ value: sealed, nowMs: this.deps.now().epochMilliseconds })
        : undefined;
      const email = extractHintedAddress({ hint, providerId: hintProviderId, echoedRoundTrip });
      try {
        const answer = await withinClassificationTime({
          pending: this.deps.refusedSignIns.classifyRefusedSignIn({ refusedBy, email }),
          reference,
        });
        if (answer === "timed_out") {
          logger.warn(
            { reference, providerId: hintProviderId },
            "classifying a refused sign-in took too long; the person was sent the plain refusal",
          );
        } else {
          verdict = answer;
        }
      } catch (error) {
        logger.error(
          { error, reference, providerId: hintProviderId },
          "a refused sign-in could not be classified; the person was sent the plain refusal",
        );
      }
    }
    // An expected refusal (a cancelled consent, or e.g. Entra "Assignment required"): nothing
    // for on-call. Never the address: the reference ties this line to the card.
    logger.warn(
      {
        reference,
        providerId: source?.hintProviderId ?? null,
        answeredCode,
        organizationId: verdict?.organizationId ?? null,
        idp: verdict?.idp ?? null,
        outcome: verdict?.outcome ?? "refused",
      },
      "an identity provider refused a sign-in; the person was told why",
    );
    return refusedSignInLocationOf({ location, verdict, reference });
  }
}

/** How long a refused sign-in's redirect waits on classifying it; the recording carries on. */
const CLASSIFICATION_WAIT_MS = 3_000;

/** A classification that fails after the wait ran out is logged here, since no caller awaits it. */
async function withinClassificationTime<Value>({
  pending,
  reference,
}: {
  pending: Promise<Value>;
  reference: string | null;
}): Promise<Value | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitRanOut = false;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => {
      waitRanOut = true;
      resolve("timed_out");
    }, CLASSIFICATION_WAIT_MS);
  });
  pending.catch((error: unknown) => {
    if (!waitRanOut) return;
    logger.warn(
      { error, reference },
      "classifying a refused sign-in failed after the redirect stopped waiting on it",
    );
  });
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
