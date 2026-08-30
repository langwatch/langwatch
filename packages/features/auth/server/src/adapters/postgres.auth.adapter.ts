import type { AuthService as AuthCapability } from "@langwatch/auth-contract";
import type { UserService } from "@langwatch/user-contract";
import type { IdentityEmailService } from "@langwatch/identity-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { AuthClockPort } from "../ports/auth-clock.port";
import { AuthSecondaryStorePort } from "../ports/auth-secondary-store.port";
import { AuthSessionRepository } from "../repositories/auth-session.repository";
import { AuthService } from "../services/auth.service";

type PrismaAuthDatabase = {
  session: {
    findUnique(input: {
      where: { id: string };
      select: { id: true; userId: true; sessionToken: true; impersonating: true };
    }): Promise<{
      id: string;
      userId: string;
      sessionToken: string;
      impersonating: unknown;
    } | null>;
    findMany(input: {
      where: { userId: string };
      select: { sessionToken: true };
    }): Promise<Array<{ sessionToken: string }>>;
    deleteMany(input: {
      where: { id?: string; userId?: string; NOT?: { id: string } };
    }): Promise<{ count: number }>;
  };
  user: {
    findUnique(input: {
      where: { id: string };
      select: { id: true; deactivatedAt: true };
    }): Promise<{ id: string; deactivatedAt: Date | null } | null>;
  };
};

class SystemAuthClock extends AuthClockPort {
  now(): Date {
    return new Date();
  }
}

class PrismaAuthSessionRepository extends AuthSessionRepository {
  static create(database: PrismaAuthDatabase): PrismaAuthSessionRepository {
    return new PrismaAuthSessionRepository(database);
  }

  private constructor(private readonly database: PrismaAuthDatabase) {
    super();
  }

  async tryFindById(input: {
    id: string;
  }): Promise<{ id: string; userId: string; sessionToken: string; impersonating: unknown } | null> {
    return this.database.session.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, sessionToken: true, impersonating: true },
    });
  }

  async isUserActive({ id }: { id: string }): Promise<boolean> {
    const user = await this.database.user.findUnique({
      where: { id },
      select: { id: true, deactivatedAt: true },
    });
    return user !== null && user.deactivatedAt === null;
  }

  async listTokensForUser({ userId }: { userId: string }): Promise<string[]> {
    const sessions = await this.database.session.findMany({
      where: { userId },
      select: { sessionToken: true },
    });
    return sessions.map(({ sessionToken }) => sessionToken);
  }

  async deleteAllForUser({ userId }: { userId: string }): Promise<number> {
    const deleted = await this.database.session.deleteMany({ where: { userId } });
    return deleted.count;
  }

  async deleteById({ id }: { id: string }): Promise<number> {
    const deleted = await this.database.session.deleteMany({ where: { id } });
    return deleted.count;
  }

  async deleteOthersForUser({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<number> {
    const deleted = await this.database.session.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });
    return deleted.count;
  }
}

class RedisAuthSecondaryStore extends AuthSecondaryStorePort {
  static create(redis: RedisConnection | null): RedisAuthSecondaryStore | null {
    return redis ? new RedisAuthSecondaryStore(redis) : null;
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  async get({ key }: { key: string }): Promise<string | null> {
    return this.redis.get(key);
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    await this.redis.set(key, value);
  }

  async delete({ key }: { key: string }): Promise<void> {
    await this.redis.del(key);
  }
}

/** Public composition adapter; repositories and technical ports remain private. */
export class PostgresAuthAdapter {
  static create(input: {
    database: PrismaAuthDatabase;
    redis: RedisConnection | null;
    identityEmails: IdentityEmailService;
    users: UserService;
  }): PostgresAuthAdapter {
    return new PostgresAuthAdapter(input);
  }

  private constructor(
    private readonly input: {
      database: PrismaAuthDatabase;
      redis: RedisConnection | null;
      identityEmails: IdentityEmailService;
      users: UserService;
    },
  ) {}

  build(): AuthCapability {
    return AuthService.create({
      clock: new SystemAuthClock(),
      repository: PrismaAuthSessionRepository.create(this.input.database),
      secondaryStore: RedisAuthSecondaryStore.create(this.input.redis),
      identityEmails: this.input.identityEmails,
      users: this.input.users,
    });
  }
}
