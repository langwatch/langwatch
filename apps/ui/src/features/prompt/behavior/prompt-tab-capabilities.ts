/** Everything the tab store needs from the browser, resolved by this shell. */
export type PromptTabCapabilities = {
  storage: {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  logger: {
    info(message: string): void;
    info(fields: Record<string, unknown>, message: string): void;
    warn(message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
    error(message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
  };
};
