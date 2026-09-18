let canParseBuffer;
export function detectBufferParsing() {
    if (canParseBuffer === undefined) {
        try {
            if (typeof Buffer !== "function") {
                canParseBuffer = false;
            }
            else {
                const result = JSON.parse(Buffer.from([0x7b, 0x7d]));
                canParseBuffer = result !== null && typeof result === "object";
            }
        }
        catch {
            canParseBuffer = false;
        }
    }
    return canParseBuffer;
}
