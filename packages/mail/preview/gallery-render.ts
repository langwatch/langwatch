import type { renderMailTemplate as RenderMailTemplate } from "../src/templates/registry";
import type { MailTemplate } from "../src/templates/registry";
import type { GalleryEntry } from "./studio-shared";

/**
 * Every fixture the gallery shows, rendered through the same call the single
 * template view and the real send path use — there is no second rendering
 * code path for the grid.
 */
export const buildGalleryEntries = async (
  templates: readonly MailTemplate[],
  renderMailTemplate: typeof RenderMailTemplate,
  options: { everyFixture: boolean },
): Promise<GalleryEntry[]> => {
  const entries = templates.flatMap((template) =>
    (options.everyFixture ? template.fixtures : template.fixtures.slice(0, 1)).map((fixture) => ({
      template,
      fixture,
    })),
  );
  return Promise.all(
    entries.map(async ({ template, fixture }) => {
      const { subject, html, text } = await renderMailTemplate(template, fixture.props);
      return {
        template: template.id,
        title: template.title,
        fixture: fixture.name,
        subject,
        html,
        text,
      };
    }),
  );
};
