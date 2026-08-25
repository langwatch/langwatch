/**
 * The simulation repository runs in Node. Keep this narrow declaration local
 * until the workspace packages its shared Node type baseline.
 */
declare const Buffer: {
  from(
    value: string,
    encoding?: string,
  ): {
    toString(encoding: string): string;
  };
};
