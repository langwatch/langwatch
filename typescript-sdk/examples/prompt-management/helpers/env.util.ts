export const EnvUtil = {
  /**
   * Returns the environment variable or throws if missing.
   */
  getOrThrow(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`${key} is required`);
    }
    return value;
  },
};


