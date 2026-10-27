import { InvalidArgumentError } from "commander";

/** `--dataset-version <n>`: a whole version number from 1, or a usage error. */
export const parseDatasetVersionFlag = (value: string): number => {
  const version = /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new InvalidArgumentError(`expected a whole number from 1, got "${value}"`);
  }
  return version;
};
