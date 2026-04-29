import type React from "react";
import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import { Dialog } from "~/components/ui/dialog";
import { useTraceListRefresh } from "../../hooks/useTraceListRefresh";
import { useViewStore } from "../../stores/viewStore";
import { useWelcomeStore } from "../../stores/welcomeStore";
import { WelcomeDialog } from "./WelcomeDialog";

const WELCOME_SEEN_KEY = "langwatch:traces-v2:welcome-seen";

export const WelcomeScreen: React.FC = () => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const close = useWelcomeStore((s) => s.close);
  const selectLens = useViewStore((s) => s.selectLens);
  const refresh = useTraceListRefresh();
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
    useWelcomeStore.getState().setWelcomeBoom(true);
    refresh();
    close();
  }, [setSeen, selectLens, close, refresh]);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e) => {
        if (!e.open) handleDismiss({ remember: false });
      }}
      size="xl"
      placement="center"
      motionPreset="scale"
      closeOnInteractOutside={false}
      closeOnEscape={false}
    >
      <Dialog.Content
        portalled={false}
        aria-label="Welcome to Traces"
        maxWidth="820px"
        width="full"
        bg="bg.panel/12"
        borderRadius="2xl"
        borderWidth="1px"
        borderColor="border.muted"
        // Outer drop shadow + an inset vignette so the backdrop blur fades
        // softly toward the rounded edge instead of clipping abruptly.
        boxShadow="0 24px 60px rgba(0,0,0,0.35), inset 0 0 80px 0 rgba(0,0,0,0.28)"
        padding={6}
        backdropFilter="blur(25px) saturate(100%)"
        backdropProps={{
          // Chakra's Dialog.Backdrop recipe ships `position: fixed; width:
          // 100vw; height: 100dvh`. With `portalled={false}` the backdrop
          // renders inside the dashboard's content-area container, but the
          // 100vw width overflows that container's `maxWidth: calc(100vw -
          // menuWidth)` and surfaces a horizontal scrollbar. Inline-style
          // overrides to beat the recipe class.
          style: {
            position: "absolute",
            inset: 0,
            width: "auto",
            height: "auto",
          },
          backdropFilter: "blur(10px)",
          background: "blackAlpha.500",
        }}
        positionerProps={{
          // Inline style so we beat the Chakra dialog recipe's class CSS.
          // The recipe ships `position: fixed; width: 100vw; height: 100dvh`
          // — without overriding width/height the positioner stays viewport-
          // sized even after we flip to `position: absolute`, so its center
          // sits below + right of the dashboard content area's center.
          //
          // overflow:hidden traps any sub-pixel overflow from the centered
          // Content + blur layer so the surrounding scroll container can't
          // pick it up and surface a horizontal scrollbar.
          style: {
            position: "absolute",
            inset: 0,
            width: "auto",
            height: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
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
