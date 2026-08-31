import type { SavedViewsPort } from "../transport/api-trpc/saved-view.api";
import type { SavedViewJson, SavedViewRecord } from "../ports/dashboard.port";
import {
  SavedViewRepository,
  type SavedViewDatabase,
} from "../repositories/prisma/prisma.saved-view.repository";
import { SavedViewService } from "../services/saved-view.service";

/**
 * The saved-view lifecycle over Postgres, in the shape the transport asks for.
 *
 * The service takes the create arguments nested under `input` and stores the
 * filters and the period as JSON; the port passes them flat, as the
 * client sends them. This adapter is that one translation and nothing else, so
 * the rows the client receives carry the same fields they always have.
 */
export class PostgresSavedViewAdapter {
  private constructor(private readonly options: { database: SavedViewDatabase }) {}

  static create(options: { database: SavedViewDatabase }): PostgresSavedViewAdapter {
    return new PostgresSavedViewAdapter(options);
  }

  build(): SavedViewsPort<SavedViewRecord> {
    const savedViews = new SavedViewService(new SavedViewRepository(this.options.database));

    return {
      getAll: (input) => savedViews.getAll(input),
      create: ({ projectId, filters, period, ...view }) =>
        savedViews.createView({
          projectId,
          input: {
            ...view,
            filters: filters as SavedViewJson,
            ...(period === undefined ? {} : { period: period as SavedViewJson }),
          },
        }),
      delete: (input) => savedViews.delete(input),
      rename: (input) => savedViews.rename(input),
      reorder: (input) => savedViews.reorder(input),
    };
  }
}
