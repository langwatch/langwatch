import React from "react";
import { getRawColorValue } from "../ui/color-mode";

interface AISparklesLoaderProps {
  className?: string;
  size?: number;
  color?: string;
}

export const AISparklesLoader = ({
  size = 24,
  color = "blue.400",
}: AISparklesLoaderProps) => {
  const color_ = getRawColorValue(color);

  return (
    <div>
      <svg width={size} height={size} viewBox="0 0 24 24">
        {/* Star 1: Top Right */}
        <path
          style={{
            animation: "sparkleSmall1 0.9s infinite ease-in-out 0.3s",
            transformOrigin: "75% 25%",
          }}
          fill={color_}
          d="M19 9 l 1.25-2.75 L23 5 l-2.75-1.25 L19 1 l-1.25 2.75 L15 5 l2.75 1.25 z"
        />
        {/* Star 2: Center/Large */}
        <path
          style={{
            animation: "sparkleLarge 0.9s infinite ease-in-out",
            transformOrigin: "40% 50%",
          }}
          fill={color_}
          d="M11.5 9.5 L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12 z"
        />
        {/* Star 3: Bottom Right */}
        <path
          style={{
            animation: "sparkleSmall2 0.9s infinite ease-in-out 0.6s",
            transformOrigin: "75% 75%",
          }}
          fill={color_}
          d="M19 15 l-1.25 2.75 L15 19 l2.75 1.25 L19 23 l1.25-2.75 L23 19 l-2.75-1.25 z"
        />

        <style>
          {`
            @keyframes sparkleLarge {
              0%, 100% { transform: scale(0.8); opacity: 0.9; }
              50% { transform: scale(1.2); opacity: 1; } /* Subtle pulse */
            }
            @keyframes sparkleSmall1 {
              0%, 100% { transform: scale(0.8); opacity: 0.8; }
              50% { transform: scale(1.2); opacity: 1; } /* Slightly larger pulse */
            }
            @keyframes sparkleSmall2 {
              0%, 100% { transform: scale(0.8); opacity: 0.8; }
              50% { transform: scale(1.2); opacity: 1; } /* Slightly larger pulse */
            }

            /* Keyframes are defined above, animations applied inline */
          `}
        </style>
      </svg>
    </div>
  );
};
