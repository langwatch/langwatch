import type { TopicService as TopicServiceContract } from "@langwatch/topic-contract";
import {
  PrismaTopicRepository,
  type TopicDatabase,
} from "../repositories/prisma/prisma.topic.repository";
import { TopicService } from "../services/topic.service";
import type { TopicClusteringSchedulePort } from "../ports/topic-clustering-schedule.port";

export class PostgresTopicAdapter {
  static create(options: {
    database: TopicDatabase;
    schedule: TopicClusteringSchedulePort;
    now?: () => number;
  }): TopicServiceContract {
    return TopicService.create({
      repository: PrismaTopicRepository.create(options.database),
      schedule: options.schedule,
      now: options.now,
    });
  }
}
