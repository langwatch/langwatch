import { Box } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FullLogo } from "./icons/FullLogo";
import { LightMode } from "./ui/color-mode";

let logoVisibleOnce = false;

export const LoadingScreen = () => {
  const [showLogo, setShowLogo] = useState(logoVisibleOnce);

  useEffect(() => {
    setTimeout(() => {
      setShowLogo(true);
      setTimeout(() => {
        logoVisibleOnce = true;
      }, 500);
    }, 50);
  }, []);

  const fullLogo = (
    <LightMode>
      <FullLogo width={155 * 1.2} height={38 * 1.2} />
    </LightMode>
  );

  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      bg="#FAFAFA"
      position="relative"
      paddingBottom={16}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      {/* Orange mesh gradient background */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        overflow="hidden"
        zIndex={0}
        style={{
          contain: "layout paint",
          background: [
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(237,137,38,0.06) 0%, transparent 70%)",
            "radial-gradient(ellipse 60% 40% at 70% 100%, rgba(237,137,38,0.02) 0%, transparent 60%)",
          ].join(", "),
        }}
      />

      <Box position="relative" zIndex={1}>
        {!logoVisibleOnce ? (
          <AnimatePresence>
            {showLogo && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {fullLogo}
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          fullLogo
        )}
      </Box>
    </Box>
  );
};
