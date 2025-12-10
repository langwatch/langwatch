export const HandleUtil = {
  /**
   * Builds a unique prompt handle for isolation.
   */
  unique(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  },
};




