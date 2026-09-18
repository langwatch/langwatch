/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Estimate size of a number encoded as varint.
 * @param v value to calculate size for
 * @returns size in bytes of the varint encoding of the value
 */
export function estimateVarintSize(v) {
    if (v < 0)
        return 10;
    if (v < 0x80)
        return 1;
    if (v < 0x4000)
        return 2;
    if (v < 0x200000)
        return 3;
    if (v < 0x10000000)
        return 4;
    if (v < 0x800000000)
        return 5;
    if (v < 0x40000000000)
        return 6;
    if (v < 0x2000000000000)
        return 7;
    if (v < 0x100000000000000)
        return 8;
    return 9;
}
//# sourceMappingURL=utils.js.map