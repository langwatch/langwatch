import type { Prisma, PrismaClient, SavedView } from "@langwatch/prisma-client/generated";
import type { SavedViewsPort } from "../transport/api-trpc/saved-view.api";
import { SavedViewRepository } from "../repositories/prisma/prisma.saved-view.repository";
import { SavedViewService } from "../services/saved-view.service";

/**
 * The saved-view lifecycle over Postgres, in the shape the transport asks for.
 *
 * The service takes the create arguments nested under `input` and stores the
 * filters and the period as Prisma JSON; the port passes them flat, as the
 * client sends them. This adapter is that one translation and nothing else, so
 * the rows the client receives stay the `SavedView` rows it has always had.
 */
export class PostgresSavedViewAdapter {
  private constructor(private readonly options: { database: PrismaClient }) {}

  static create(options: { database: PrismaClient }): PostgresSavedViewAdapter {
    return new PostgresSavedViewAdapter(options);
  }

  build(): SavedViewsPort<SavedView> {
    const savedViews = new SavedViewService(new SavedViewRepository(this.options.database));

    return {
      getAll: (input) => savedViews.getAll(input),
      create: ({ projectId, filters, period, ...view }) =>
        savedViews.createView({
          projectId,
          input: {
            ...view,
            filters: filters as Prisma.InputJsonValue,
            ...(period === undefined ? {} : { period: period as Prisma.InputJsonValue }),
          },
        }),
      delete: (input) => savedViews.delete(input),
      rename: (input) => savedViews.rename(input),
      reorder: (input) => savedViews.reorder(input),
    };
  }
}
