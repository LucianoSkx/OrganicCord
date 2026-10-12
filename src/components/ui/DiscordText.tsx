import React from "react";
import { useExternalLinkStore } from "@/stores/externalLinkStore";

interface DiscordTextProps {
  content: string;
  style?: React.CSSProperties;
  className?: string;
}

export function DiscordText({ content, style, className }: DiscordTextProps) {
  if (!content) return null;

  const regex = /<(a?):([^:]+):(\d+)>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }
    const isAnimated = match[1] === "a";
    const name = match[2];
    const id = match[3];
    const ext = isAnimated ? "gif" : "webp";

    parts.push(
      <img
        key={match.index}
        src={`https://cdn.discordapp.com/emojis/${id}.${ext}?size=44&quality=lossless`}
        alt={`:${name}:`}
        title={`:${name}:`}
        style={{
          width: "1.375em",
          height: "1.375em",
          verticalAlign: "bottom",
          display: "inline-block",
          objectFit: "contain",
          margin: "0 0.1em",
        }}
      />
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  // Agora vamos processar cada parte de texto puro para extrair URLs
  const finalParts: React.ReactNode[] = [];

  parts.forEach((part, index) => {
    if (typeof part === "string") {
      // Um regex novo por parte evita que o lastIndex vaze entre os pedaços.
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      let match: RegExpExecArray | null;
      let lastUrlIndex = 0;
      while ((match = urlRegex.exec(part)) !== null) {
        const url = match[1];
        if (match.index > lastUrlIndex) {
          finalParts.push(part.substring(lastUrlIndex, match.index));
        }
        finalParts.push(
          <a
            key={`url-${index}-${match.index}`}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              useExternalLinkStore.getState().openExternalLink(url);
            }}
            className="hover-underline"
            style={{ color: "var(--text-link)", textDecoration: "none", cursor: "pointer" }}
            onMouseOver={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
            onMouseOut={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
          >
            {url}
          </a>
        );
        lastUrlIndex = urlRegex.lastIndex;
      }
      if (lastUrlIndex < part.length) {
        finalParts.push(part.substring(lastUrlIndex));
      }
    } else {
      finalParts.push(part);
    }
  });

  return (
    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...style }} className={className}>
      {finalParts}
    </span>
  );
}
