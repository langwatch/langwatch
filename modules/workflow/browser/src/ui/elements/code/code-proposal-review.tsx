import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box, HStack, VStack } from "@langwatch/design-system/primitives";
import { lazy, Suspense } from "react";

const MonacoDiffEditor = lazy(async () => ({
  default: (await import("@monaco-editor/react")).DiffEditor,
}));

/**
 * Langy's proposal beside the buffer it would replace. Accept hands the code back for the
 * buffer; Reject drops it. Neither saves: the reader still does.
 */
export function CodeProposalReview({
  original,
  proposed,
  summary,
  language,
  onAccept,
  onReject,
}: {
  original: string;
  proposed: string;
  summary: string;
  language: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { colorMode } = useColorMode();

  return (
    <VStack gap={0} height="full" align="stretch" data-testid="code-proposal-review">
      <Banner
        status="info"
        placement="top"
        title="Langy proposes a change"
        action={
          <HStack gap={2}>
            <BannerAction onClick={onReject}>Reject</BannerAction>
            <BannerAction onClick={onAccept}>Accept</BannerAction>
          </HStack>
        }
      >
        {summary}
      </Banner>
      <Box flex={1} minHeight={0}>
        <Suspense fallback={<div style={{ padding: "0 16px" }}>Loading the change...</div>}>
          <MonacoDiffEditor
            height="100%"
            original={original}
            modified={proposed}
            language={language}
            theme={colorMode === "dark" ? "vs-dark" : "vs"}
            options={{ readOnly: true, originalEditable: false, minimap: { enabled: false } }}
          />
        </Suspense>
      </Box>
    </VStack>
  );
}
