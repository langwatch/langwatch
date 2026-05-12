import { useState } from "react";
import {
  Box,
  Button,
  Heading,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Bomb,
  FileQuestion,
  AlertTriangle,
  PanelRight,
  Square,
  Skull,
} from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";
import { Link } from "~/components/ui/link";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageErrorFallback } from "~/components/ui/PageErrorFallback";

function ThrowOnRender(): never {
  throw new Error("Test error: component crashed during render");
}

function CrashableContent({ label }: { label: string }) {
  const [shouldCrash, setShouldCrash] = useState(false);

  if (shouldCrash) {
    return <ThrowOnRender />;
  }

  return (
    <VStack gap={3} padding={4}>
      <Text textStyle="sm">This is the {label} content.</Text>
      <Button
        size="sm"
        colorPalette="red"
        onClick={() => setShouldCrash(true)}
      >
        <Bomb size={14} />
        Crash it
      </Button>
    </VStack>
  );
}

function InnerContent({
  onCrashOuter,
}: {
  onCrashOuter: () => void;
}) {
  const [shouldCrash, setShouldCrash] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (shouldCrash) {
    return <ThrowOnRender />;
  }

  return (
    <>
      <Box flex={1} padding={8} overflowY="auto">
        <VStack gap={6} maxWidth="900px" marginX="auto">
          <VStack gap={2}>
            <Heading size="lg" color="fg.default">
              Error Boundary Test
            </Heading>
            <Text textStyle="sm" color="fg.muted" textAlign="center">
              Dev-only page for testing error boundaries and the 404 page.
            </Text>
          </VStack>

          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4} width="full">
            {/* Inner crash — stays in shell */}
            <Box
              padding={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border"
            >
              <VStack gap={3}>
                <AlertTriangle
                  size={20}
                  color="var(--chakra-colors-red-400)"
                />
                <Text textStyle="sm" fontWeight="medium">
                  Crash page content (inner)
                </Text>
                <Text textStyle="xs" color="fg.muted" textAlign="center">
                  Caught by DashboardLayout's ErrorBoundary — sidebar and header
                  stay visible.
                </Text>
                <Button
                  size="sm"
                  colorPalette="red"
                  onClick={() => setShouldCrash(true)}
                >
                  <Bomb size={14} />
                  Crash inner
                </Button>
              </VStack>
            </Box>

            {/* Outer crash — full-screen fallback */}
            <Box
              padding={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border"
            >
              <VStack gap={3}>
                <Skull
                  size={20}
                  color="var(--chakra-colors-red-600)"
                />
                <Text textStyle="sm" fontWeight="medium">
                  Crash entire page (outer)
                </Text>
                <Text textStyle="xs" color="fg.muted" textAlign="center">
                  Crashes outside DashboardLayout — caught by RootLayout's
                  ErrorBoundary. Full-screen error fallback, no shell.
                </Text>
                <Button
                  size="sm"
                  colorPalette="red"
                  variant="solid"
                  onClick={onCrashOuter}
                >
                  <Skull size={14} />
                  Crash outer
                </Button>
              </VStack>
            </Box>

            {/* Dialog crash */}
            <Box
              padding={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border"
            >
              <VStack gap={3}>
                <Square
                  size={20}
                  color="var(--chakra-colors-orange-400)"
                />
                <Text textStyle="sm" fontWeight="medium">
                  Crash inside a Dialog
                </Text>
                <Text textStyle="xs" color="fg.muted" textAlign="center">
                  Opens a dialog, then crashes its content.
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogOpen(true)}
                >
                  <Square size={14} />
                  Open dialog
                </Button>
              </VStack>
            </Box>

            {/* Drawer crash */}
            <Box
              padding={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border"
            >
              <VStack gap={3}>
                <PanelRight
                  size={20}
                  color="var(--chakra-colors-blue-400)"
                />
                <Text textStyle="sm" fontWeight="medium">
                  Crash inside a Drawer
                </Text>
                <Text textStyle="xs" color="fg.muted" textAlign="center">
                  Opens a drawer, then crashes its content.
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDrawerOpen(true)}
                >
                  <PanelRight size={14} />
                  Open drawer
                </Button>
              </VStack>
            </Box>

            {/* 404 link */}
            <Box
              padding={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border"
            >
              <VStack gap={3}>
                <FileQuestion
                  size={20}
                  color="var(--chakra-colors-orange-400)"
                />
                <Text textStyle="sm" fontWeight="medium">
                  Test 404 Page
                </Text>
                <Text textStyle="xs" color="fg.muted" textAlign="center">
                  Navigate to a URL that doesn't match any route.
                </Text>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/no-such-project-slug">
                    <FileQuestion size={14} />
                    Go to 404
                  </Link>
                </Button>
              </VStack>
            </Box>
          </SimpleGrid>
        </VStack>
      </Box>

      {/* Dialog with crashable content */}
      <Dialog.Root
        open={dialogOpen}
        onOpenChange={({ open }) => setDialogOpen(open)}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Test Dialog</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <ErrorBoundary FallbackComponent={PageErrorFallback}>
              <CrashableContent label="dialog" />
            </ErrorBoundary>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      {/* Drawer with crashable content */}
      <Drawer.Root
        open={drawerOpen}
        onOpenChange={({ open }) => setDrawerOpen(open)}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Test Drawer</Drawer.Title>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <ErrorBoundary FallbackComponent={PageErrorFallback}>
              <CrashableContent label="drawer" />
            </ErrorBoundary>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}

function ErrorTestPage() {
  const [shouldCrashOuter, setShouldCrashOuter] = useState(false);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  if (shouldCrashOuter) {
    return <ThrowOnRender />;
  }

  return (
    <DashboardLayout>
      <InnerContent onCrashOuter={() => setShouldCrashOuter(true)} />
    </DashboardLayout>
  );
}

export default ErrorTestPage;
