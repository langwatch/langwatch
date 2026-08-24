export type BillingNotification = {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  metadata: unknown;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingJsonValue =
  | string
  | number
  | boolean
  | null
  | BillingJsonValue[]
  | { [key: string]: BillingJsonValue };

export type CreateNotificationParams = {
  organizationId: string;
  projectId?: string | null;
  metadata: BillingJsonValue;
  sentAt: Date;
};

export abstract class NotificationRepository {
  abstract findRecentByOrganization(
    organizationId: string,
    since: Date,
  ): Promise<BillingNotification[]>;
  abstract create(
    params: CreateNotificationParams,
  ): Promise<BillingNotification>;
  abstract findById(id: string): Promise<BillingNotification | null>;
}
