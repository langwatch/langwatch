import {
  type NotificationService,
  WEB_PUSH_BODY_MAX,
  WEB_PUSH_TITLE_MAX,
} from "@langwatch/notification-contract";

import { type AccessNoticePush, AccessNoticePushChannel } from "../access-notice-push.channel.ts";

type Notifications = Pick<NotificationService, "requestWebPushDelivery">;

const clipped = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Seat request pushes queued through notification, recorded on an organization's project. */
export class HttpAccessNoticePushChannel extends AccessNoticePushChannel {
  static create(input: { notifications: Notifications }): HttpAccessNoticePushChannel {
    return new HttpAccessNoticePushChannel(input.notifications);
  }

  private constructor(private readonly notifications: Notifications) {
    super();
  }

  async push(input: AccessNoticePush): Promise<void> {
    await this.notifications.requestWebPushDelivery({
      userId: input.userId,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      topic: input.topic,
      urgency: "normal",
      message: {
        title: clipped(input.title, WEB_PUSH_TITLE_MAX),
        body: clipped(input.body, WEB_PUSH_BODY_MAX),
        url: input.url,
        tag: input.topic,
      },
    });
  }
}
