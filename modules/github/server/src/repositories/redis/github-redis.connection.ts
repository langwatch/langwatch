
export type GithubRedisConnection = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  getdel?: (key: string) => Promise<string | null>;
  eval?: (script: string, numKeys: number, ...args: string[]) => Promise<number | string | null>;
};

function isRedisConnection(value: object): value is GithubRedisConnection {
  return (
    "get" in value &&
    typeof value.get === "function" &&
    "set" in value &&
    typeof value.set === "function" &&
    "del" in value &&
    typeof value.del === "function"
  );
}

/**
 * The command surface every Redis-backed GitHub row is written through, and
 * the process client behind it. It lives here rather than beside the App
 * token minter because it is the store, not a provider.
 */
export abstract class GithubRedis {
  abstract tryGet(key: string): Promise<string | null>;
  abstract trySet(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  abstract delete(key: string): Promise<number>;
  abstract tryGetDelete(key: string): Promise<string | null>;
  abstract tryEval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>;
}

/** Keeps the process Redis client behind the GitHub feature's private port. */
export class RedisGithubAdapter extends GithubRedis {
  static create(connection: GithubRedisConnection): RedisGithubAdapter {
    if (!isRedisConnection(connection)) {
      throw new TypeError("GitHub requires a Redis-compatible connection");
    }

    return new RedisGithubAdapter(connection);
  }

  private constructor(private readonly connection: GithubRedisConnection) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    return this.connection.get(key);
  }

  trySet(key: string, value: string, ...args: (string | number)[]): Promise<string | null> {
    return this.connection.set(key, value, ...args);
  }

  delete(key: string): Promise<number> {
    return this.connection.del(key);
  }

  tryGetDelete(key: string): Promise<string | null> {
    return this.connection.getdel?.(key) ?? Promise.resolve(null);
  }

  tryEval(script: string, numKeys: number, ...args: string[]): Promise<number | string | null> {
    return this.connection.eval?.(script, numKeys, ...args) ?? Promise.resolve(null);
  }
}
