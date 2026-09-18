import { createAggregatedClient } from "@smithy/core/client";
import { CreateOAuth2TokenCommand, } from "./commands/CreateOAuth2TokenCommand";
import { CreateOAuth2TokenWithIAMCommand, } from "./commands/CreateOAuth2TokenWithIAMCommand";
import { SigninClient } from "./SigninClient";
const commands = {
    CreateOAuth2TokenCommand,
    CreateOAuth2TokenWithIAMCommand,
};
export class Signin extends SigninClient {
}
createAggregatedClient(commands, Signin);
