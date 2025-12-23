import { Box } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FullLogo } from "./icons/FullLogo";

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

  const fullLogo = <FullLogo width={155 * 1.2} height={38 * 1.2} />;

  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      backgroundColor="bg.emphasized"
      paddingBottom={16}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
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
  );
};
