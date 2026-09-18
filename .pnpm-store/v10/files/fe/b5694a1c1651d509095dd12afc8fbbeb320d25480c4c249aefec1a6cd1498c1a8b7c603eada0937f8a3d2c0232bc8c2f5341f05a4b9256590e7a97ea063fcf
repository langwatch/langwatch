import { getSSOTokenFilepath } from "@smithy/core/config";
import { promises as fsPromises } from "node:fs";
const { writeFile } = fsPromises;
export const writeSSOTokenToFile = (id, ssoToken) => {
    const tokenFilepath = getSSOTokenFilepath(id);
    const tokenString = JSON.stringify(ssoToken, null, 2);
    return writeFile(tokenFilepath, tokenString);
};
