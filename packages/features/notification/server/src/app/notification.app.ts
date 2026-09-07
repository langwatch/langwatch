import {
  NotificationApi,
  type NotificationApi as NotificationApiContract,
} from "@langwatch/notification-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { PostgresNotificationAdapter } from "../adapters/postgres.notification.adapter.ts";
import type { NotificationDatabase } from "../repositories/prisma/prisma.notification.repository.ts";
import { DefaultNotificationService } from "../services/notification.service.ts";

export type NotificationInfrastructure = Readonly<{ prisma: NotificationDatabase }>;

export class NotificationApp implements NotificationApiContract {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};

  #service: DefaultNotificationService;

  private constructor(service: DefaultNotificationService) {
    this.#service = service;
  }

  static create({
    infrastructure,
  }: FeatureSetup<typeof NotificationApp.dependencies, NotificationInfrastructure, undefined>) {
    const service = PostgresNotificationAdapter.create({ database: infrastructure.prisma }).build();
    return new NotificationApp(service);
  }

  listRecentByOrganization: NotificationApiContract["listRecentByOrganization"] = (input) =>
    this.#service.listRecentByOrganization(input);

  create: NotificationApiContract["create"] = (input) => this.#service.create(input);
}
