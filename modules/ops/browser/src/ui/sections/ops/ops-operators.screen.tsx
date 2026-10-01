import { PageLayout } from "@langwatch/design-system/page-layout";

import { OperatorsContent } from "../../../features/operators/ui/sections/operators-content.tsx";

export default function OpsOperatorsScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Operators</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <OperatorsContent />
      </PageLayout.Container>
    </>
  );
}
