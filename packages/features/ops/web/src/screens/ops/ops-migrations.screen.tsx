import { PageLayout } from "@langwatch/design-system/page-layout";
import { MigrationsContent } from "../../features/migrations/ui/sections/migrations-content";

export default function OpsMigrationsScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Migrations</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <MigrationsContent />
      </PageLayout.Container>
    </>
  );
}
