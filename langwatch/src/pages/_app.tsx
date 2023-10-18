import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "~/utils/api";

import {
  ChakraProvider,
  defineStyleConfig,
  type StyleFunctionProps,
} from "@chakra-ui/react";
import "~/styles/globals.scss";

import { extendTheme } from "@chakra-ui/react";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { useEffect } from "react";

const inter = Inter({ subsets: ["latin"] });

export const theme = extendTheme({
  styles: {
    global: (_props: StyleFunctionProps) => ({
      body: {
        fontFamily: inter.style.fontFamily,
      },
    }),
  },
  colors: {
    gray: {
      800: "#090F1D",
      700: "#1F2937",
      600: "#213B41",
      500: "#51676C",
      400: "#9CA3AF",
      300: "#E5E7EB",
      200: "#F2F4F8",
      100: "#F7FAFC",
    },
    orange: {
      400: "#ED8926",
      300: "#FF9E2C",
      200: "#FFD19B",
      100: "#FFF3E4",
    },
  },
  components: {
    Card: defineStyleConfig({
      baseStyle: {
        container: {
          boxShadow: "0px 4px 10px 0px rgba(0, 0, 0, 0.06)",
        },
      },
    }),
  },
});

const LangWatch: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  const router = useRouter();

  useEffect(() => {
    const handleChangeStart = () => NProgress.start();
    const handleChangeDone = () => NProgress.done();

    router.events.on("routeChangeStart", handleChangeStart);
    router.events.on("routeChangeComplete", handleChangeDone);
    router.events.on("routeChangeError", handleChangeDone);

    return () => {
      router.events.off("routeChangeStart", handleChangeStart);
      router.events.off("routeChangeComplete", handleChangeDone);
      router.events.off("routeChangeError", handleChangeDone);
    };
  }, [router]);

  return (
    <SessionProvider session={session}>
      <ChakraProvider theme={theme}>
        <Head>
          <link
            rel="stylesheet"
            href="https://cdnjs.cloudflare.com/ajax/libs/nprogress/0.2.0/nprogress.min.css"
          />
        </Head>
        <Component {...pageProps} />
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
