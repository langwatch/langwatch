export const getUpdatedSystemClockOffset = (clockTime, currentSystemClockOffset, timeRequestSent, ageHeader) => {
    if (ageHeader !== undefined) {
        return currentSystemClockOffset;
    }
    const serverTime = Date.parse(clockTime);
    const timeResponseReceived = Date.now();
    if (timeRequestSent !== undefined && timeResponseReceived - timeRequestSent > 900_000) {
        return currentSystemClockOffset;
    }
    const candidateSkew = timeRequestSent !== undefined
        ? serverTime - (timeRequestSent + timeResponseReceived) / 2
        : serverTime - timeResponseReceived;
    return candidateSkew;
};
