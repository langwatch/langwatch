import type { SavedViewsPort } from "../transport/api-trpc/saved-view.api.ts";
import type { SavedViewJson, SavedViewRecord } from "../ports/dashboard.port.ts";
import {
  PrismaSavedViewRepository,
  type SavedViewDatabase,
} from "../repositories/prisma/prisma.saved-view.repository.ts";
import { SavedViewService } from "../services/saved-view.service.ts";

/**
 * The saved-view lifecycle over Postgres, in the shape the transport asks for. The service
 * takes the create arguments nested under `input` and stores the filters and the period as
 * JSON; the port passes them flat, as the client sends them.
 */
export class PostgresSavedViewAdapter {
  private constructor(private readonly options: { database: SavedViewDatabase }) {}

  static create(options: { database: SavedViewDatabase }): PostgresSavedViewAdapter {
    return new PostgresSavedViewAdapter(options);
  }

  build(): SavedViewsPort<SavedViewRecord> {
    const savedViews = SavedViewService.create({
      repository: PrismaSavedViewRepository.create({ database: this.options.database }),
    });

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
