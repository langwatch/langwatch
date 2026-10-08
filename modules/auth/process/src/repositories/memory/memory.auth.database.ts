import type { Session, Verification } from "better-auth";

/**
 * A `Session` row as Better Auth's memory adapter holds it: mapped names and
 * the adapter's own stamp type, never `Instant` (a transaction structuredClones
 * the tables). Inventory columns are optional: a test's revocation row has none.
 */
export type MemorySessionRow = {
  id: string;
  userId: string;
  sessionToken: string;
  /** The {actor, subject} claims (D06), flat as the Prisma columns hold them. */
  actorUserId?: string | null;
  subjectUserId?: string | null;
  impersonationReason?: string | null;
  impersonationExpiresAt?: Date | null;
  expires?: Session["expiresAt"];
  createdAt?: Session["createdAt"];
  updatedAt?: Session["updatedAt"];
  ipAddress?: string | null;
  userAgent?: string | null;
  amr?: readonly string[];
  identifierId?: string | null;
  /** The idle-window stamp (GAC-10), absent on a session never under one. */
  lastSeenAt?: Date;
};

/** One `VerificationToken` row; the `id` is what a transaction commit merges by. */
export type MemoryVerificationTokenRow = {
  id: string;
  identifier: string;
  token: string;
  expires: Verification["expiresAt"];
  createdAt?: Verification["createdAt"];
  updatedAt?: Verification["updatedAt"];
};

/** The `User` columns auth's own repositories read; Better Auth writes the rest. */
export type MemoryUserRow = {
  id: string;
  email?: string | null;
  name?: string | null;
  emailVerified?: boolean;
  deactivatedAt?: Date | null;
  pendingSsoSetup?: boolean;
  signupConfirmationPending?: boolean;
  lastLoginAt?: Date | null;
};

/** One `Account` row, under the column names the channel maps Better Auth's onto. */
export type MemoryAccountRow = {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
};

/** Better Auth's tables by the model names the channel maps them to. */
type MemoryAuthTables = {
  User: Record<string, unknown>[];
  Account: Record<string, unknown>[];
  Session: MemorySessionRow[];
  VerificationToken: MemoryVerificationTokenRow[];
  twoFactor: Record<string, unknown>[];
  passkey: Record<string, unknown>[];
  ssoProvider: Record<string, unknown>[];
};

/**
 * Auth's tables as one `memoryAdapter` database the twins share. Every table
 * exists up front (the adapter creates one only on `create`); a commit or a
 * delete replaces a table's array, so read `db.<Model>` per call, never keep it.
 */
export class MemoryAuthDatabase {
  readonly db: MemoryAuthTables = {
    User: [],
    Account: [],
    Session: [],
    VerificationToken: [],
    twoFactor: [],
    passkey: [],
    ssoProvider: [],
  };

  private constructor() {}

  static create(): MemoryAuthDatabase {
    return new MemoryAuthDatabase();
  }
}
