import { PageLayout } from "@langwatch/design-system/page-layout";
import { VStack } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { UpgradePreview } from "./upgrade-preview.tsx";
import { UpgradeReadState } from "./upgrade-read-state.tsx";

/** W5: `upgrade plan --to` for `?to=`, the image's release when none is asked for. */
export default function UpgradePreviewScreen() {
  const router = useOpsRouter();
  const asked = router.query.to;
  const status = api.ops.upgrade.status.useQuery(void 0, { enabled: asked === void 0 });
  const to = asked ?? status.data?.image ?? "";
  const preview = api.ops.upgrade.preview.useQuery({ to }, { enabled: to !== "" });

  return (
    <>
      <PageLayout.Header
        flexWrap="wrap"
        actions={
          <PageLayout.HeaderButton onClick={() => router.push("/ops/upgrades")}>
            Back to upgrades
          </PageLayout.HeaderButton>
        }
      >
        <VStack gap={1} align="start" minWidth={0}>
          <PageLayout.Heading>Upgrade preview{to ? ` to ${to}` : ""}</PageLayout.Heading>
          <PageLayout.Subtitle>
            Review the plan and preflight checks before applying an upgrade.
          </PageLayout.Subtitle>
        </VStack>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <UpgradeReadState
          read={{
            data: preview.data,
            isError: status.isError || preview.isError,
            error: status.isError ? status.error : preview.error,
          }}
          failedTitle="The upgrade preview could not load"
        >
          {(answer) => <UpgradePreview preview={answer} />}
        </UpgradeReadState>
      </PageLayout.Container>
    </>
  );
}
