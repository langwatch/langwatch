// The session a request carries, READ and never enforced: the web door's half of
// verification, which every surface reading a browser cookie shares.

/** Who a verified browser cookie stands for, as anything reading one sees it. */
export type SessionCaller = Readonly<{
  /** The signed-in person, absent for a verified cookie with no live session. */
  userId?: string | undefined;
  email?: string | undefined;
  name?: string | null | undefined;
  image?: string | null | undefined;
  /** Who is acting as them, where somebody is. */
  impersonator?:
    | Readonly<{
        id?: string | undefined;
        name?: string | null | undefined;
        email?: string | null | undefined;
        image?: string | null | undefined;
      }>
    | undefined;
  /** The project a key-credentialled caller stands for, where one did. */
  apiKeyProjectId?: string | undefined;
  /** The live session's own id, where the deployment tracks one. */
  sessionId?: string | undefined;
  /** The RAW verified auth-session id, before any live-session lookup. */
  authSessionId?: string | undefined;
}>;

/**
 * The half of session verification no module can do — reading and verifying
 * this deployment's own cookie — joined to the half only the auth module can.
 * Composed once; nothing holds either half on its own.
 */
export type SessionVerification = (request: Request) => Promise<SessionCaller | null>;

/**
 * Reads the session a request carries, answering `SessionCaller` or `null`. It refuses, redirects
 * and gates nobody: every enforcement path decides for itself from that answer.
 */
export class SessionReader {
  /** A deployment that composed a verifier. */
  static create(options: { verify: SessionVerification }): SessionReader {
    return new SessionReader(options.verify);
  }

  /**
   * A deployment that composed none. Every read answers `null`, and each
   * reader takes its own branch — the routes still exist and refuse, rather
   * than an unverified caller being let through.
   */
  static unverified(): SessionReader {
    return new SessionReader(void 0);
  }

  /**
   * One answer per request, however many readers ask: some routes resolve
   * nobody and still need a session, and verifying once avoids four round
   * trips to the session store for one request.
   */
  readonly #answers = new WeakMap<Request, Promise<SessionCaller | null>>();

  private constructor(private readonly verify: SessionVerification | undefined) {}

  /** Whether this deployment composed anything at all behind the cookie. */
  get verifies(): boolean {
    return this.verify !== void 0;
  }

  read(request: Request): Promise<SessionCaller | null> {
    const already = this.#answers.get(request);
    if (already) return already;

    const answering = this.verify?.(request) ?? Promise.resolve(null);
    this.#answers.set(request, answering);

    return answering;
  }
}
