import { BinaryDecisionDiagram } from "@smithy/core/endpoints";
const m = "ref";
const a = -1, b = true, c = "isSet", d = "PartitionResult", e = "booleanEquals", f = "getAttr", g = "stringEquals", h = { [m]: "Endpoint" }, i = { [m]: d }, j = { [m]: "Region" }, k = {}, l = [j];
const _data = {
    conditions: [
        [c, [h]],
        [c, l],
        ["aws.partition", l, d],
        [e, [{ [m]: "UseFIPS" }, b]],
        [e, [{ fn: f, argv: [i, "supportsFIPS"] }, b]],
        [e, [{ [m]: "UseDualStack" }, b]],
        [e, [{ fn: f, argv: [i, "supportsDualStack"] }, b]],
        [g, [{ fn: f, argv: [i, "name"] }, "aws"]],
        [g, [j, "us-east-1"]],
        [g, [j, "us-east-2"]],
        [g, [j, "us-west-1"]],
        [g, [j, "us-west-2"]]
    ],
    results: [
        [a],
        [a, "Invalid Configuration: FIPS and custom endpoint are not supported"],
        [a, "Invalid Configuration: Dualstack and custom endpoint are not supported"],
        [h, k],
        ["https://cognito-identity-fips.us-east-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-east-2.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-2.amazonaws.com", k],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "FIPS and DualStack are enabled, but this partition does not support one or both"],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "FIPS is enabled but this partition does not support FIPS"],
        ["https://cognito-identity.{Region}.amazonaws.com", k],
        ["https://cognito-identity.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "DualStack is enabled but this partition does not support DualStack"],
        ["https://cognito-identity.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "Invalid Configuration: Missing Region"]
    ]
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1, 1, -1,
    0, 17, 3,
    1, 4, r + 16,
    2, 5, r + 16,
    3, 9, 6,
    5, 7, r + 15,
    6, 8, r + 14,
    7, r + 12, r + 13,
    4, 11, 10,
    5, r + 9, r + 11,
    5, 12, r + 10,
    6, 13, r + 9,
    8, r + 4, 14,
    9, r + 5, 15,
    10, r + 6, 16,
    11, r + 7, r + 8,
    3, r + 1, 18,
    5, r + 2, r + 3,
]);
export const bdd = BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);
