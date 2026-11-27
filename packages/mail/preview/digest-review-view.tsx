import { Badge, Callout, Page, Stack, Text } from "@langwatch/design-system-internal";
import { useEffect, useState, type JSX, type ReactNode } from "react";

import { GalleryCard } from "./gallery-view.tsx";
import { digestReviewUrl } from "./studio-endpoints.ts";
import {
  digestReviewResponseSchema,
  WIDTHS,
  type DigestReviewSection,
  type DigestReviewVersion,
} from "./studio-shared.ts";

export interface DigestReviewViewProps {
  nav: ReactNode;
  previewDark: boolean;
}

/** The weekly digests in send order, each fixture as it would arrive today, A beside B. */
export const DigestReviewView = ({ nav, previewDark }: DigestReviewViewProps): JSX.Element => {
  const { sections, failure } = useDigestReview();
  return (
    <Page
      nav={nav}
      width="full"
      title="Digest review"
      subtitle="Each person gets at most one a week per organisation: the first below they qualify for. No activity, no email."
    >
      <Stack gap={6}>
        <Callout title="Not in production yet">
          The What&apos;s new card and email, and click tracking: links go straight to LangWatch.
        </Callout>
        {failure && (
          <Callout tone="error" title="The digests could not load">
            {failure}
          </Callout>
        )}
        {!failure && !sections && <Text tone="secondary">Rendering the digests…</Text>}
        {sections?.map((section, index) => (
          <ReviewSection
            key={section.templateId}
            section={section}
            rank={index + 1}
            previewDark={previewDark}
          />
        ))}
      </Stack>
    </Page>
  );
};

function ReviewSection({
  section,
  rank,
  previewDark,
}: {
  section: DigestReviewSection;
  rank: number;
  previewDark: boolean;
}): JSX.Element {
  return (
    <section className="mailroom-review" aria-labelledby={`review-${section.templateId}`}>
      <Stack gap={3}>
        <h2 id={`review-${section.templateId}`} className="mailroom-review-heading">
          {rank}. {section.title}
        </h2>
        <Text as="p">
          <strong>Who gets this:</strong> {section.whoGetsThis}
        </Text>
        <Text as="p" tone="secondary">
          Shown without what the sender leaves out today: {section.notFilledToday.join(", ")}.
        </Text>
        <ReviewVersion version={section.versionA} previewDark={previewDark} />
        {section.versionB ? (
          <ReviewVersion version={section.versionB} previewDark={previewDark} />
        ) : (
          <div className="mailroom-review-empty">
            <Badge>Version B</Badge> <Text tone="secondary">No B version yet</Text>
          </div>
        )}
      </Stack>
    </section>
  );
}

function ReviewVersion({
  version,
  previewDark,
}: {
  version: DigestReviewVersion;
  previewDark: boolean;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <div>
        <Badge tone="brand">{version.label}</Badge>
      </div>
      <div className="mailroom-review-grid">
        {version.cards.map((card) => (
          <Stack key={card.fixture} gap={2}>
            <Text as="p">
              <strong>Subject:</strong> {card.subject}
            </Text>
            <GalleryCard
              entry={card}
              viewportWidth={WIDTHS.desktop}
              density="comfortable"
              previewDark={previewDark}
            />
          </Stack>
        ))}
      </div>
    </Stack>
  );
}

function useDigestReview(): {
  sections: DigestReviewSection[] | null;
  failure: string | null;
} {
  const [sections, setSections] = useState<DigestReviewSection[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(digestReviewUrl(), { signal: controller.signal })
      .then((response) => response.json())
      .then((json: unknown) => {
        const body = digestReviewResponseSchema.parse(json);
        if ("error" in body) setFailure(body.error);
        else setSections(body);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(String(error));
      });
    return () => controller.abort();
  }, []);
  return { sections, failure };
}
