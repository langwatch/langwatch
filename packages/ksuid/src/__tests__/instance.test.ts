import { describe, it, expect } from "vitest";

import { Instance } from "../instance.ts";
import type { InstanceSchemeType } from "../instance.ts";

describe("Instance", () => {
  it("creates instance with random scheme and buffer", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = new Instance(Instance.schemes.RANDOM, buffer);
    expect(instance.scheme).toBe(Instance.schemes.RANDOM);
    expect(instance.identifier).toStrictEqual(buffer);
  });

  it("creates instance with MAC_AND_PID scheme and buffer", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = new Instance(Instance.schemes.MAC_AND_PID, buffer);
    expect(instance.scheme).toBe(Instance.schemes.MAC_AND_PID);
    expect(instance.identifier).toStrictEqual(buffer);
  });

  it("creates instance with DOCKER_CONT scheme and buffer", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = new Instance(Instance.schemes.DOCKER_CONT, buffer);
    expect(instance.scheme).toBe(Instance.schemes.DOCKER_CONT);
    expect(instance.identifier).toStrictEqual(buffer);
  });

  it("throws an error for invalid scheme", () => {
    expect(() => {
      new Instance(256 as InstanceSchemeType, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    }).toThrow("scheme must be a uint8");
  });

  it("throws an error for invalid identifier length", () => {
    expect(() => {
      new Instance(Instance.schemes.RANDOM, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    }).toThrow("identifier must be 8 bytes");
  });

  it("converts to buffer correctly", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = new Instance(Instance.schemes.RANDOM, buffer);
    const result = instance.toBuffer();
    const expected = new Uint8Array([Instance.schemes.RANDOM, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result).toStrictEqual(expected);
  });

  it("creates from buffer correctly", () => {
    const buffer = new Uint8Array([Instance.schemes.RANDOM, 1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = Instance.fromBuffer(buffer);
    expect(instance.scheme).toBe(Instance.schemes.RANDOM);
    expect(instance.identifier).toStrictEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it("throws an error for invalid buffer length", () => {
    expect(() => {
      Instance.fromBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); // 8 bytes instead of 9
    }).toThrow("buffer must be 9 bytes");
  });

  it("converts to string correctly", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const instance = new Instance(Instance.schemes.RANDOM, buffer);
    const result = instance.toString();
    expect(result).toBe("Instance(scheme=82, identifier=1,2,3,4,5,6,7,8)");
  });

  it("compares instances correctly", () => {
    const buffer1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const buffer2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const buffer3 = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);

    const instance1 = new Instance(Instance.schemes.RANDOM, buffer1);
    const instance2 = new Instance(Instance.schemes.RANDOM, buffer2);
    const instance3 = new Instance(Instance.schemes.RANDOM, buffer3);
    const instance4 = new Instance(Instance.schemes.MAC_AND_PID, buffer1);

    expect(instance1.equals(instance2)).toBe(true);
    expect(instance1.equals(instance3)).toBe(false);
    expect(instance1.equals(instance4)).toBe(false);
    expect(instance1.equals({} as Instance)).toBe(false);
  });
});
