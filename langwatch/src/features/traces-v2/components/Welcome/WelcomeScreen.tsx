import type React from "react";
import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import { Dialog } from "~/components/ui/dialog";
import { useFreshnessSignal } from "../../stores/freshnessSignal";
import { useViewStore } from "../../stores/viewStore";
import { useWelcomeStore } from "../../stores/welcomeStore";
import { WelcomeDialog } from "./WelcomeDialog";

const WELCOME_SEEN_KEY = "langwatch:traces-v2:welcome-seen";

export const WelcomeScreen: React.FC = () => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const close = useWelcomeStore((s) => s.close);
  const selectLens = useViewStore((s) => s.selectLens);
  const [, setSeen] = useLocalStorage<boolean>(WELCOME_SEEN_KEY, false);

  const handleDismiss = useCallback(
    ({ remember }: { remember: boolean }) => {
      if (remember) setSeen(true);
      close();
    },
    [setSeen, close],
  );

  const handleFinish = useCallback(() => {
    setSeen(true);
    selectLens("all-traces");
    const freshness = useFreshnessSignal.getState();
    freshness.setWelcomeBoom(true);
    freshness.refresh?.();
    close();
  }, [setSeen, selectLens, close]);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e) => {
        if (!e.open) handleDismiss({ remember: false });
      }}
      size="xl"
      motionPreset="scale"
      closeOnInteractOutside={false}
      closeOnEscape={false}
    >
      <Dialog.Content
        portalled={false}
        aria-label="Welcome to Traces"
        maxWidth="820px"
        width="full"
        bg="bg.panel/25"
        borderRadius="2xl"
        borderWidth="1px"
        borderColor="border.muted"
        boxShadow="2xl"
        padding={6}
        backdropFilter="blur(96px) saturate(140%)"
        backdropProps={{
          position: "absolute",
          inset: 0,
          backdropFilter: "blur(14px)",
          background: "blackAlpha.500",
        }}
        positionerProps={{
          position: "absolute",
          inset: 0,
        }}
      >
        <WelcomeDialog
          onSkip={() => handleDismiss({ remember: false })}
          onFinish={handleFinish}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
};
