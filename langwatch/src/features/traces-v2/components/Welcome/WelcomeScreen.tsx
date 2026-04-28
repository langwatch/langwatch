import type React from "react";
import { useCallback } from "react";
import { Dialog } from "~/components/ui/dialog";
import { useWelcomeSeen } from "../../hooks/useWelcomeSeen";
import { useFreshnessSignal } from "../../stores/freshnessSignal";
import { useViewStore } from "../../stores/viewStore";
import { useWelcomeStore } from "../../stores/welcomeStore";
import { WelcomeDialog } from "./WelcomeDialog";

export const WelcomeScreen: React.FC = () => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const close = useWelcomeStore((s) => s.close);
  const { markSeen } = useWelcomeSeen();
  const selectLens = useViewStore((s) => s.selectLens);

  const handleDismiss = useCallback(
    ({ remember }: { remember: boolean }) => {
      if (remember) markSeen();
      close();
    },
    [markSeen, close],
  );

  const handleFinish = useCallback(() => {
    markSeen();
    selectLens("all-traces");
    const freshness = useFreshnessSignal.getState();
    freshness.setWelcomeBoom(true);
    freshness.refresh?.();
    close();
  }, [markSeen, selectLens, close]);

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
        bg="bg.panel/50"
        borderRadius="2xl"
        borderWidth="1px"
        borderColor="border.muted"
        boxShadow="2xl"
        padding={6}
        backdropFilter="blur(60px)"
        backdropProps={{
          style: { position: "absolute", inset: 0 },
          backdropFilter: "blur(10px)",
          background: "bg.canvas/50",
        }}
        positionerProps={{
          style: { position: "absolute", inset: 0 },
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
