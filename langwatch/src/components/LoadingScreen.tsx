import { Box } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { Provider as ChakraProvider } from "~/components/ui/provider";

import { FullLogo } from "./icons/FullLogo";
import { useEffect, useState } from "react";

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

  return (
    <ChakraProvider>
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
                <FullLogo />
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          <FullLogo />
        )}
      </Box>
    </ChakraProvider>
  );
};
