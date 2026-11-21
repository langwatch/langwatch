import type { UserApi } from "@langwatch/user-contract";

import type { GatewayUserDirectoryChannel } from "../gateway-user-directory.channel.ts";

/** Asks the user module this tier is bound to; an account it no longer finds is gone. */
export class HttpGatewayUserDirectoryChannel implements GatewayUserDirectoryChannel {
  static create({ users }: { users: Pick<UserApi, "findById"> }): HttpGatewayUserDirectoryChannel {
    return new HttpGatewayUserDirectoryChannel(users);
  }

  private constructor(private readonly users: Pick<UserApi, "findById">) {}

  async accountExists({ userId }: { userId: string }): Promise<boolean> {
    return (await this.users.findById({ id: userId })) !== null;
  }
}
