import {
  RedisConfigService,
  RedisConnectionService,
  RedisShutdownService,
  type RedisConfigResolution,
  type RedisConnection,
  type RedisEnvironment,
  type RedisLogger,
} from "@langwatch/redis-client";

/**
 * The serving App's one Redis capability. Replay and migration executables own
 * their deliberately standalone connections separately (ADR-093).
 */
export class AppRedisRuntime {
  static create(input: { config: RedisEnvironment; logger: RedisLogger }): AppRedisRuntime {
    const configService = new RedisConfigService();
    const resolution = configService.resolve(input.config);
    const connection = new RedisConnectionService({
      logger: input.logger,
      config: configService,
    }).connectResolved({ config: resolution });
    const shutdown = RedisShutdownService.create();

    return new AppRedisRuntime({ connection, resolution, shutdown });
  }

  readonly connection: RedisConnection | null;
  readonly resolution: RedisConfigResolution;

  private closing: Promise<void> | undefined;

  private constructor({
    connection,
    resolution,
    shutdown,
  }: {
    connection: RedisConnection | null;
    resolution: RedisConfigResolution;
    shutdown: RedisShutdownService;
  }) {
    this.connection = connection;
    this.resolution = resolution;
    this.shutdown = shutdown;
  }

  private readonly shutdown: RedisShutdownService;

  /** Closes this runtime's connection once, including concurrent shutdowns. */
  close(): Promise<void> {
    this.closing ??= this.closeConnection();
    return this.closing;
  }

  private closeConnection(): Promise<void> {
    if (this.connection === null) return Promise.resolve();
    return this.shutdown.shutdown(this.connection);
  }
}
