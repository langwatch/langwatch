import {
  Button,
  HStack,
  Input,
  Select,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { DashboardLayout } from "../../components/DashboardLayout";
import {
  usePlaygroundStore,
  type ChatWindowState,
  type PlaygroundTabState,
} from "../../hooks/usePlaygroundStore";
import { useChat } from "ai/react";
import { useState } from "react";
import models from "../../../../models.json";
import { Azure } from "../../components/icons/Azure";
import { OpenAI } from "../../components/icons/OpenAI";
import {
  Select as MultiSelect,
  chakraComponents,
  type SingleValue,
} from "chakra-react-select";
import { Meta } from "../../components/icons/Meta";
import { Mistral } from "../../components/icons/Mistral";
import { Anthropic } from "../../components/icons/Anthropic";

export default function Playground() {
  const state = usePlaygroundStore((state) => state);
  const { undo, redo } = usePlaygroundStore.temporal.getState();

  return (
    <DashboardLayout>
      <Tabs>
        <HStack width="full">
          <TabList width="full">
            {state.tabs.map((tab, index) => (
              <Tab key={index}>{tab.name}</Tab>
            ))}
          </TabList>
          <HStack>
            <Button onClick={() => undo()}>Undo</Button>
            <Button onClick={() => redo()}>Redo</Button>
          </HStack>
        </HStack>

        <TabPanels>
          {state.tabs.map((tab, tabIndex) => (
            <PlaygroundTab key={tabIndex} tab={tab} tabIndex={tabIndex} />
          ))}
        </TabPanels>
      </Tabs>
    </DashboardLayout>
  );
}

function PlaygroundTab({
  tab,
  tabIndex,
}: {
  tab: PlaygroundTabState;
  tabIndex: number;
}) {
  return (
    <TabPanel key={tabIndex}>
      <HStack>
        {tab.chatWindows.map((chatWindow, windowIndex) => (
          <ChatWindow
            key={windowIndex}
            chatWindow={chatWindow}
            tabIndex={tabIndex}
            windowIndex={windowIndex}
          />
        ))}
      </HStack>
    </TabPanel>
  );
}

function ChatWindow({
  chatWindow,
  tabIndex,
  windowIndex,
}: {
  chatWindow: ChatWindowState;
  tabIndex: number;
  windowIndex: number;
}) {
  const addChatWindow = usePlaygroundStore((state) => state.addChatWindow);

  type ModelOption = {
    label: string;
    value: string;
    icon: React.ReactNode;
  };

  const providerIcons: Record<string, React.ReactNode> = {
    azure: <Azure />,
    openai: <OpenAI />,
    meta: <Meta />,
    mistral: <Mistral />,
    anthropic: <Anthropic />,
  };

  const modelOptions: ModelOption[] = Object.entries(models).map(
    ([key, value]) => ({
      label: value.name,
      value: key,
      icon: providerIcons[value.model_provider],
    })
  );

  const [model, setModel] = useState<ModelOption>(modelOptions[0]!);

  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/playground",
    headers: {
      "X-Model": model.value,
    },
  });

  return (
    <div>
      <Button onClick={addChatWindow}>+</Button>
      <h1>Chat Window</h1>
      <p>
        <MultiSelect
          value={model}
          onChange={(value) => value && setModel(value)}
          options={modelOptions}
          isSearchable={false}
          components={{
            Option: ({ children, ...props }) => (
              <chakraComponents.Option {...props}>
                <HStack spacing={2}>
                  {props.data.icon}
                  <Text>{children}</Text>
                </HStack>
              </chakraComponents.Option>
            ),
            ValueContainer: ({ children, ...props }) => {
              const { getValue } = props;
              const value = getValue();
              const icon = value.length > 0 ? value[0]?.icon : null;

              return (
                <chakraComponents.ValueContainer {...props}>
                  <HStack spacing={2}>
                    {icon}
                    {children}
                  </HStack>
                </chakraComponents.ValueContainer>
              );
            },
          }}
        />
      </p>
      <VStack>
        {messages.map((m) => (
          <Text key={m.id} whiteSpace="pre-wrap">
            {m.role === "user" ? "User: " : "AI: "}
            {m.content}
          </Text>
        ))}

        <Spacer />

        <form onSubmit={handleSubmit}>
          <Input
            value={input}
            onChange={handleInputChange}
            placeholder="Say something..."
          />
        </form>
      </VStack>
    </div>
  );
}
