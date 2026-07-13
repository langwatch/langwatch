interface TestShardHardFloorOptions {
  timeoutMs: number;
  message: string;
}

export function scheduleTestShardHardFloor({
  timeoutMs,
  message,
}: TestShardHardFloorOptions): void {
  const timer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  }, timeoutMs);
  timer.unref();
}
