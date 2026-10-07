import { useState, type ImgHTMLAttributes } from "react";

export function mediaPreviewUrl(original: string, proxy: string | undefined, width: number, height: number, density = 1): string {
  // Preserve signed parameters and animation. External hosts are never given
  // invented resize parameters; a failed proxy request falls back to the original.
  if (!proxy || /\.gif(?:[?#]|$)/i.test(original)) return original;
  try {
    const url = new URL(proxy);
    if (url.protocol !== "https:" || url.hostname !== "media.discordapp.net") return original;
    const ratio = Math.max(1, Math.min(3, density));
    url.searchParams.set("width", String(Math.ceil(width * ratio)));
    url.searchParams.set("height", String(Math.ceil(height * ratio)));
    return url.toString();
  } catch { return original; }
}

export function MediaPreview({ src = "", proxyUrl, previewWidth, previewHeight, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
  proxyUrl?: string; previewWidth: number; previewHeight: number;
}) {
  const preview = mediaPreviewUrl(src, proxyUrl, previewWidth, previewHeight, window.devicePixelRatio);
  const [failed, setFailed] = useState<string | null>(null);
  return <img {...props} loading="lazy" decoding="async" src={failed === preview ? src : preview}
    onError={(event) => {
      if (preview !== src && failed !== preview) setFailed(preview);
      else props.onError?.(event);
    }} />;
}
