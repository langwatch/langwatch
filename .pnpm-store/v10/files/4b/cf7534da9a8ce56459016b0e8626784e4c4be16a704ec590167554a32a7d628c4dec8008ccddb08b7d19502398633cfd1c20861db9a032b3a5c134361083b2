import { createAggregatedClient } from "@smithy/core/client";
import { CognitoIdentityClient } from "./CognitoIdentityClient";
import { GetCredentialsForIdentityCommand, } from "./commands/GetCredentialsForIdentityCommand";
import { GetIdCommand } from "./commands/GetIdCommand";
const commands = {
    GetCredentialsForIdentityCommand,
    GetIdCommand,
};
export class CognitoIdentity extends CognitoIdentityClient {
}
createAggregatedClient(commands, CognitoIdentity);
