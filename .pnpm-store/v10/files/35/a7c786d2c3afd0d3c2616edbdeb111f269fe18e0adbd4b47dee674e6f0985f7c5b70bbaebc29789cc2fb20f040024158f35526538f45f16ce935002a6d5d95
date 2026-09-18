import { expectUnion } from "@smithy/core/serde";
export const awsExpectUnion = (value) => {
    if (value == null) {
        return undefined;
    }
    if (typeof value === "object" && "__type" in value) {
        delete value.__type;
    }
    return expectUnion(value);
};
