import { GithubRedisPort } from "../ports/github-app-token.port";

type RedisConnection = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  getdel?: (key: string) => Promise<string | null>;
  eval?: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | string | null>;
};

function isRedisConnection(value: object): value is RedisConnection {
  return (
    "get" in value &&
    typeof value.get === "function" &&
    "set" in value &&
    typeof value.set === "function" &&
    "del" in value &&
    typeof value.del === "function"
  );
}

/** Keeps the process Redis client behind the GitHub feature's private port. */
export class RedisGithubAdapter extends GithubRedisPort {
  static create(connection: object): RedisGithubAdapter {
    if (!isRedisConnection(connection)) {
      throw new TypeError("GitHub requires a Redis-compatible connection");
    }

    return new RedisGithubAdapter(connection);
  }

  private constructor(private readonly connection: RedisConnection) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    return this.connection.get(key);
  }

  trySet(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null> {
    return this.connection.set(key, value, ...args);
  }

  delete(key: string): Promise<number> {
    return this.connection.del(key);
  }

  tryGetDelete(key: string): Promise<string | null> {
    return this.connection.getdel?.(key) ?? Promise.resolve(null);
  }

  tryEval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null> {
    return this.connection.eval?.(script, numKeys, ...args) ?? Promise.resolve(null);
  }
}
