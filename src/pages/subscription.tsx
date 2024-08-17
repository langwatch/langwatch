import { type NextPage } from "next";
import dynamic from "next/dynamic";

const Subscription = dynamic(() => import("../components/Subscription"), {
  ssr: false,
});

const SubscriptionPage: NextPage = () => <Subscription />;

export default SubscriptionPage;
